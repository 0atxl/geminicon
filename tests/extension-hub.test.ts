import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionHub } from "../src/hub/extension-hub.js";
import {
  GEMINICON_PROTOCOL_VERSION,
  GatewayTask,
  WSClientMessage,
} from "../src/types.js";

const credential = "test-credential-value-123456";

function clientMessage<T extends Omit<WSClientMessage, "protocolVersion">>(
  value: T
): T & { protocolVersion: 1 } {
  return {
    ...value,
    protocolVersion: GEMINICON_PROTOCOL_VERSION,
  };
}

function mockSocket() {
  const handlers = new Map<string, (...args: any[]) => void>();
  const sent: any[] = [];
  const ws: any = {
    readyState: 1,
    send: vi.fn((raw: string) => sent.push(JSON.parse(raw))),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
    }),
  };
  return {
    ws,
    sent,
    receive(message: WSClientMessage | Record<string, unknown> | string) {
      handlers.get("message")?.(
        typeof message === "string" ? message : JSON.stringify(message)
      );
    },
    close() {
      handlers.get("close")?.();
    },
  };
}

function registerReady(hub: ExtensionHub, socket = mockSocket()) {
  hub.handleConnection(socket.ws);
  socket.receive(clientMessage({
    type: "REGISTER",
    credential,
    deviceId: "device-1",
    clientVersion: "1.0.0",
  }));
  const probe = socket.sent.find((message) => message.type === "PROBE_STATUS");
  socket.receive(clientMessage({
    type: "DEVICE_STATUS",
    probeId: probe.probeId,
    status: "ready",
    geminiAuthenticated: true,
    contentScriptResponsive: true,
    temporaryChatAvailable: true,
    models: ["gemini-web"],
  }));
  return socket;
}

function task(id: string): GatewayTask {
  return { id, model: "gemini-web", prompt: id, createdAt: Date.now() };
}

describe("ExtensionHub fail-closed transport", () => {
  let hub: ExtensionHub;

  beforeEach(() => {
    hub = new ExtensionHub(10, 5000, 50);
  });

  afterEach(async () => {
    await hub.close();
    vi.useRealTimers();
  });

  it("does not route a connected worker until a valid readiness probe succeeds", async () => {
    const socket = mockSocket();
    hub.handleConnection(socket.ws);
    socket.receive(clientMessage({
      type: "REGISTER",
      credential,
      deviceId: "device-1",
      clientVersion: "1.0.0",
    }));

    expect(hub.getConnectedWorkerCount()).toBe(1);
    expect(hub.getReadyWorkerCount()).toBe(0);
    expect(hub.hasWorker(credential)).toBe(false);
    await expect(hub.executeTask(credential, task("not-ready"))).rejects.toMatchObject({
      errorType: "worker_not_connected",
    });
  });

  it("dispatches and accepts only the matching task attempt", async () => {
    const socket = registerReady(hub);
    const resultPromise = hub.executeTask(credential, task("task-1"));
    const execute = socket.sent.find((message) => message.type === "EXECUTE_TASK");

    socket.receive(clientMessage({
      type: "TASK_COMPLETE",
      taskId: "task-1",
      attemptId: "stale-attempt",
      text: "stale",
      latencyMs: 1,
    }));
    socket.receive(clientMessage({
      type: "TASK_COMPLETE",
      taskId: "task-1",
      attemptId: execute.attemptId,
      text: "ok",
      latencyMs: 10,
    }));

    await expect(resultPromise).resolves.toMatchObject({ text: "ok" });
  });

  it("waits for cancellation acknowledgement before advancing the queue and ignores late completion", async () => {
    const socket = registerReady(hub);
    const queue = hub.getUserQueue(credential);
    const first = queue.enqueue(task("first"));
    const second = queue.enqueue(task("second"));
    const firstExecute = socket.sent.find((message) => message.type === "EXECUTE_TASK");

    hub.cancelTask(credential, "first");
    expect(socket.sent.filter((message) => message.type === "EXECUTE_TASK")).toHaveLength(1);

    socket.receive(clientMessage({
      type: "TASK_COMPLETE",
      taskId: "first",
      attemptId: firstExecute.attemptId,
      text: "late",
      latencyMs: 2,
    }));
    expect(socket.sent.filter((message) => message.type === "EXECUTE_TASK")).toHaveLength(1);

    socket.receive(clientMessage({
      type: "TASK_CANCELLED",
      taskId: "first",
      attemptId: firstExecute.attemptId,
      ready: true,
    }));
    await expect(first).rejects.toMatchObject({ errorType: "task_cancelled" });

    const executes = socket.sent.filter((message) => message.type === "EXECUTE_TASK");
    expect(executes).toHaveLength(2);
    expect(executes[1].taskId).toBe("second");
    socket.receive(clientMessage({
      type: "TASK_COMPLETE",
      taskId: "second",
      attemptId: executes[1].attemptId,
      text: "second-ok",
      latencyMs: 3,
    }));
    await expect(second).resolves.toMatchObject({ text: "second-ok" });
  });

  it("marks a worker unusable without disconnecting when cancellation acknowledgement times out", async () => {
    vi.useFakeTimers();
    const socket = registerReady(hub);
    const pending = hub.executeTask(credential, task("cancel-timeout"));
    const rejection = expect(pending).rejects.toMatchObject({
      errorType: "task_cancelled",
    });
    hub.cancelTask(credential, "cancel-timeout");
    await vi.advanceTimersByTimeAsync(51);

    await rejection;
    expect(hub.hasWorker(credential)).toBe(false);
    expect(socket.ws.close).not.toHaveBeenCalled();
  });

  it("routes generation timeout through cancellation and preserves the timeout error", async () => {
    vi.useFakeTimers();
    const socket = registerReady(hub);
    const pending = hub.executeTask(credential, task("generation-timeout"), 20);
    await vi.advanceTimersByTimeAsync(21);
    const cancel = socket.sent.find((message) => message.type === "CANCEL_TASK");
    expect(cancel).toBeTruthy();
    socket.receive(clientMessage({
      type: "TASK_CANCELLED",
      taskId: "generation-timeout",
      attemptId: cancel.attemptId,
      ready: true,
    }));
    await expect(pending).rejects.toMatchObject({ errorType: "generation_timeout" });
  });

  it("rejects an active task when its worker disconnects", async () => {
    const socket = registerReady(hub);
    const pending = hub.executeTask(credential, task("disconnect"));
    socket.close();
    await expect(pending).rejects.toMatchObject({ errorType: "worker_not_connected" });
    expect(hub.hasWorker(credential)).toBe(false);
  });

  it("closes enum-invalid protocol messages without logging their values", () => {
    const socket = registerReady(hub);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    socket.receive(clientMessage({
      type: "TASK_ERROR",
      taskId: "x",
      attemptId: "y",
      errorType: "not-real" as any,
      message: "secret-value",
    }));
    expect(socket.ws.close).toHaveBeenCalledWith(1008, "Invalid message");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it("never includes the registration credential in acknowledgements or errors", () => {
    const socket = registerReady(hub);
    expect(JSON.stringify(socket.sent)).not.toContain(credential);
    expect(socket.sent.find((message) => message.type === "REGISTER_ACK")).not.toHaveProperty("key");
  });

  it("does not reflect extension-supplied credential text in task errors", async () => {
    const socket = registerReady(hub);
    const pending = hub.executeTask(credential, task("safe-error"));
    const execute = socket.sent.find((message) => message.type === "EXECUTE_TASK");
    socket.receive(clientMessage({
      type: "TASK_ERROR",
      taskId: "safe-error",
      attemptId: execute.attemptId,
      errorType: "upstream_error",
      message: `leaked ${credential}`,
    }));
    await expect(pending).rejects.toMatchObject({
      message: "The extension worker could not complete the task.",
    });
  });
});
