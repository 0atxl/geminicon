import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { registerChatCompletionsRoute } from "../src/api/chat-completions.js";
import { registerModelsRoute } from "../src/api/models.js";
import { registerHealthRoute } from "../src/api/health.js";
import { TaskQueue } from "../src/queue/task-queue.js";
import { GatewayError } from "../src/gateway/errors.js";

describe("API Endpoints", () => {
  let app: FastifyInstance;
  let mockWorker: ReturnType<typeof vi.fn>;
  let mockBrowserManager: any;

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
          },
        });
      }
      return reply.code(500).send({
        error: {
          message: err.message || "Internal error",
          type: "internal_error",
        },
      });
    });

    mockWorker = vi.fn(async (task) => ({
      requestId: task.id,
      text: `Generated response for: ${task.prompt}`,
      latencyMs: 150,
    }));

    const taskQueue = new TaskQueue(mockWorker, 10);

    mockBrowserManager = {
      checkHealth: vi.fn(async () => ({
        browser: "ready" as const,
        gemini: "ready" as const,
      })),
    };

    await app.register(registerChatCompletionsRoute(taskQueue));
    await app.register(registerModelsRoute);
    await app.register(registerHealthRoute(mockBrowserManager));
    await app.ready();
  });

  describe("GET /v1/models", () => {
    it("should return only gemini-web model", async () => {
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
      });
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

    it("should reject stream: true with 400 unsupported_feature", async () => {
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
      expect(body.error.message).toBe("Streaming is not supported in V1.");
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
  });
});
