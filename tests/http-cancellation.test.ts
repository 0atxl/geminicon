import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { registerChatCompletionsRoute } from "../src/api/chat-completions.js";
import { GatewayError } from "../src/gateway/errors.js";

function makeApp(
  enqueue: () => Promise<any>,
  cancelTask: (key: string, taskId: string) => void,
  captureRaw?: (raw: any) => void
) {
  const app = Fastify();
  if (captureRaw) {
    app.addHook("onRequest", (request, _reply, done) => {
      captureRaw(request.raw);
      done();
    });
  }
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof GatewayError) {
      return reply.code(error.statusCode).send(error.toPayload());
    }
    return reply.code(500).send({ error: { message: "internal" } });
  });
  const hub = {
    hasWorker: () => true,
    getUserQueue: () => ({ enqueue }),
    cancelTask,
    getConnectedWorkerCount: () => 1,
  };
  return app.register(registerChatCompletionsRoute(undefined, hub as any));
}

describe("HTTP cancellation propagation", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it("does not cancel after a normal completed HTTP request", async () => {
    const cancelTask = vi.fn();
    app = await makeApp(
      async () => ({ requestId: "request", text: "done", latencyMs: 1 }),
      cancelTask
    );
    const response = await app!.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer test-credential-value-123456" },
      payload: {
        model: "gemini-web",
        messages: [{ role: "user", content: "hello" }],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(cancelTask).not.toHaveBeenCalled();
  });

  it("cancels the matching extension task on an actual client abort", async () => {
    let rejectTask!: (error: Error) => void;
    let started!: () => void;
    const taskStarted = new Promise<void>((resolve) => { started = resolve; });
    const cancelTask = vi.fn((_key: string, _taskId: string) =>
      rejectTask(new GatewayError("cancelled", "task_cancelled", 499))
    );
    let rawRequest: any;
    app = await makeApp(
      () => new Promise((_resolve, reject) => {
        rejectTask = reject;
        started();
      }),
      cancelTask,
      (raw) => { rawRequest = raw; }
    );
    const request = app!.inject({
      url: "/v1/chat/completions",
      method: "POST",
      headers: {
        authorization: "Bearer test-credential-value-123456",
        "content-type": "application/json",
      },
      payload: {
        model: "gemini-web",
        messages: [{ role: "user", content: "abort me" }],
      },
    } as any).catch(() => undefined);
    await taskStarted;
    rawRequest.aborted = true;
    rawRequest.emit("close");
    await vi.waitFor(() => expect(cancelTask).toHaveBeenCalledTimes(1));
    expect(cancelTask.mock.calls[0][0]).toBe("test-credential-value-123456");
    expect(cancelTask.mock.calls[0][1]).toMatch(/^req_/);
    await request;
  });

  it("cancels the matching queued task in localTaskQueue on client abort", async () => {
    let rawRequest: any;
    const cancelQueued = vi.fn().mockReturnValue(true);
    let rejectTask!: (error: Error) => void;
    let started!: () => void;
    const taskStarted = new Promise<void>((resolve) => { started = resolve; });

    const localQueue: any = {
      enqueue: vi.fn(() => {
        started();
        return new Promise((_resolve, reject) => {
          rejectTask = reject;
        });
      }),
      cancelQueued,
    };

    const localApp = Fastify();
    localApp.addHook("onRequest", (request, _reply, done) => {
      rawRequest = request.raw;
      done();
    });
    localApp.setErrorHandler((error, _request, reply) => {
      if (error instanceof GatewayError) {
        return reply.code(error.statusCode).send(error.toPayload());
      }
      return reply.code(500).send({ error: { message: "internal" } });
    });
    await localApp.register(registerChatCompletionsRoute(localQueue, undefined));

    const request = localApp.inject({
      url: "/v1/chat/completions",
      method: "POST",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gemini-web",
        messages: [{ role: "user", content: "abort local" }],
      },
    } as any).catch(() => undefined);

    await taskStarted;
    rawRequest.aborted = true;
    rawRequest.emit("close");

    await vi.waitFor(() => expect(cancelQueued).toHaveBeenCalledTimes(1));
    expect(cancelQueued.mock.calls[0][0]).toMatch(/^req_/);
    expect(cancelQueued.mock.calls[0][1]).toBeInstanceOf(GatewayError);

    rejectTask(new GatewayError("Client disconnected.", "internal_error", 500));
    await request;
    await localApp.close();
  });
});
