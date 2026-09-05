import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { registerChatCompletionsRoute } from "../src/api/chat-completions.js";
import { registerModelsRoute } from "../src/api/models.js";
import { registerHealthRoute } from "../src/api/health.js";
import { TaskQueue } from "../src/queue/task-queue.js";
import { ExtensionHub } from "../src/hub/extension-hub.js";
import { GatewayError } from "../src/gateway/errors.js";

describe("API Endpoints", () => {
  let app: FastifyInstance;
  let mockWorker: ReturnType<typeof vi.fn>;
  let mockBrowserManager: any;
  let extensionHub: ExtensionHub;

  beforeEach(async () => {
    app = Fastify();

    // Global Error Handler matching server.ts
    app.setErrorHandler((error, request, reply) => {
      if (error instanceof GatewayError) {
        return reply.code(error.statusCode).send(error.toPayload());
      }
      const err = error as any;
      if (err.statusCode === 400) {
        return reply.code(400).send({
          error: {
            message: err.message || "Invalid request payload.",
            type: "invalid_request",
            code: "invalid_request",
          },
        });
      }
      return reply.code(500).send({
        error: {
          message: err.message || "Internal error",
          type: "internal_error",
          code: "internal_error",
        },
      });
    });

    app.setNotFoundHandler((request, reply) => {
      return reply.code(404).send({
        error: {
          message: `Endpoint '${request.method} ${request.url}' not found.`,
          type: "invalid_request",
          code: "endpoint_not_found",
        },
      });
    });

    mockWorker = vi.fn(async (task) => ({
      requestId: task.id,
      text: `Generated response for: ${task.prompt}`,
      latencyMs: 150,
    }));

    const taskQueue = new TaskQueue(mockWorker, 10);
    extensionHub = new ExtensionHub(10, 5000);

    mockBrowserManager = {
      checkHealth: vi.fn(async () => ({
        browser: "ready" as const,
        gemini: "ready" as const,
      })),
    };

    await app.register(registerChatCompletionsRoute(taskQueue, extensionHub));
    await app.register(registerModelsRoute);
    await app.register(registerHealthRoute(mockBrowserManager, extensionHub));
    await app.ready();
  });

  describe("GET /v1/models", () => {
    it("should expose only the model whose selection can be verified", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/models",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toEqual({
        object: "list",
        data: [
          {
            id: "gemini-web",
            object: "model",
            owned_by: "local",
          },
        ],
      });
    });
  });

  describe("GET /health", () => {
    it("should return 200 ok when browser and gemini are ready", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toEqual({
        status: "ok",
        browser: "ready",
        gemini: "ready",
        connectedWorkers: 0,
        readyWorkers: 0,
      });
    });

    it("should return 503 degraded when gemini requires authentication", async () => {
      mockBrowserManager.checkHealth.mockResolvedValueOnce({
        browser: "ready",
        gemini: "authentication_required",
      });

      const res = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.body);
      expect(body).toEqual({
        status: "degraded",
        browser: "ready",
        gemini: "authentication_required",
        connectedWorkers: 0,
        readyWorkers: 0,
      });
    });

    it("should return 503 degraded when gemini page is unavailable", async () => {
      mockBrowserManager.checkHealth.mockResolvedValueOnce({
        browser: "ready",
        gemini: "unavailable",
      });

      const res = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.body);
      expect(body).toEqual({
        status: "degraded",
        browser: "ready",
        gemini: "unavailable",
        connectedWorkers: 0,
        readyWorkers: 0,
      });
    });

    it("should return 503 error when browser is unavailable", async () => {
      mockBrowserManager.checkHealth.mockResolvedValueOnce({
        browser: "unavailable",
        gemini: "unknown",
      });

      const res = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.body);
      expect(body).toEqual({
        status: "error",
        browser: "unavailable",
        gemini: "unknown",
        connectedWorkers: 0,
        readyWorkers: 0,
      });
    });

    it("should return 200 ok when local browser is down but an extension worker is ready", async () => {
      mockBrowserManager.checkHealth.mockResolvedValueOnce({
        browser: "unavailable",
        gemini: "unknown",
      });

      // Mock connected worker
      (extensionHub as any).workers.set("w1", {
        ws: { readyState: 1 },
        key: "w1",
        connectedAt: Date.now(),
        lastHeartbeat: Date.now(),
        pendingTasks: new Map(),
        state: "ready",
      });

      const res = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe("ok");
      expect(body.browser).toBe("unavailable"); // Honestly reports local browser state!
      expect(body.connectedWorkers).toBe(1);
      expect(body.readyWorkers).toBe(1);
      (extensionHub as any).workers.delete("w1");
    });
  });

  describe("POST /v1/chat/completions", () => {
    it("should process valid OpenAI request and return ChatCompletion JSON", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "gemini-web",
          messages: [
            { role: "user", content: "What is a Kubernetes pod?" },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.object).toBe("chat.completion");
      expect(body.model).toBe("gemini-web");
      expect(body.choices[0].message.role).toBe("assistant");
      expect(body.choices[0].message.content).toContain("What is a Kubernetes pod?");
      expect(mockWorker).toHaveBeenCalledTimes(1);
    });

    it("should reject unverified named Gemini modes", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "gemini-flash",
          messages: [{ role: "user", content: "Hello Flash" }],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.type).toBe("unsupported_model");
    });

    it("should reject unsupported model with 400 unsupported_model", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "gpt-4o",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.type).toBe("unsupported_model");
    });

    it("should reject stream: true with 400 unsupported_feature and streaming_not_supported code", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "gemini-web",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.type).toBe("unsupported_feature");
      expect(body.error.code).toBe("streaming_not_supported");
      expect(body.error.message).toBe("Streaming is not supported in V1.");
    });

    it("should reject tools/functions with 400 unsupported_feature", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "gemini-web",
          messages: [{ role: "user", content: "Hello" }],
          tools: [{ type: "function", function: { name: "test" } }],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.type).toBe("unsupported_feature");
      expect(body.error.code).toBe("tools_not_supported");
    });

    it("should reject n > 1 with 400 unsupported_feature", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "gemini-web",
          messages: [{ role: "user", content: "Hello" }],
          n: 2,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.type).toBe("unsupported_feature");
      expect(body.error.code).toBe("unsupported_parameter");
    });

    it("should reject missing messages array with 400 invalid_request", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "gemini-web",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.type).toBe("invalid_request");
    });

    it("should reject multimodal content with 400 invalid_request", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "gemini-web",
          messages: [{ role: "user", content: [{ type: "image_url" }] }],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.type).toBe("invalid_request");
    });

    it("should return 503 worker_not_connected when pairing key is not connected", async () => {
      const hubOnlyApp = Fastify();
      hubOnlyApp.setErrorHandler((error, _request, reply) => {
        if (error instanceof GatewayError) {
          return reply.code(error.statusCode).send(error.toPayload());
        }
        return reply.code(500).send({ error: { message: "internal" } });
      });
      await hubOnlyApp.register(
        registerChatCompletionsRoute(undefined, extensionHub)
      );
      const res = await hubOnlyApp.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: "Bearer gcon_alice_not_connected",
        },
        payload: {
          model: "gemini-web",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.body);
      expect(body.error.type).toBe("worker_not_connected");
      expect(res.body).not.toContain("gcon_alice_not_connected");
      await hubOnlyApp.close();
    });

    it("should pass session ID and reset session flag to gateway task", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          "x-session-id": "sess_audit_test",
          "x-reset-session": "true",
        },
        payload: {
          model: "gemini-web",
          messages: [{ role: "user", content: "Hello multi-turn" }],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(mockWorker).toHaveBeenCalledTimes(1);
      const submittedTask = mockWorker.mock.calls[0][0];
      expect(submittedTask.sessionId).toBe("sess_audit_test");
      expect(submittedTask.resetSession).toBe(true);
    });

    it("should reject request when multiple workers connected but no pairing key provided and no local queue", async () => {
      const multiApp = Fastify();
      multiApp.setErrorHandler((error, request, reply) => {
        if (error instanceof GatewayError) {
          return reply.code(error.statusCode).send(error.toPayload());
        }
        return reply.code(500).send({ error: { message: (error as any).message } });
      });

      const hub = new ExtensionHub(10, 5000);
      (hub as any).workers.set("worker1", {
        ws: { readyState: 1, close: vi.fn() },
        key: "worker1",
        connectedAt: Date.now(),
        lastHeartbeat: Date.now(),
        state: "connected_not_ready",
      });

      await multiApp.register(registerChatCompletionsRoute(undefined, hub));
      const res = await multiApp.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: {
          model: "gemini-web",
          messages: [{ role: "user", content: "Hello" }],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.message).toContain("Multiple users configured");
      await hub.close();
    });

    it("should return 404 for unknown endpoint", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/unknown",
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("endpoint_not_found");
    });
  });
});
