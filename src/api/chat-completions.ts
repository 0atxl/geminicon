import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import {
  GatewayTask,
  isSupportedModel,
  OpenAIMessage,
  SUPPORTED_MODELS,
} from "../types.js";
import { GatewayError } from "../gateway/errors.js";
import { RequestNormalizer } from "../gateway/request-normalizer.js";
import { ResponseNormalizer } from "../gateway/response-normalizer.js";
import { TaskQueue } from "../queue/task-queue.js";
import { ExtensionHub } from "../hub/extension-hub.js";
import { config } from "../config.js";

const chatCompletionSchema = z.object({
  model: z.string({
    required_error: "Missing required parameter 'model'.",
  }).max(128),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"], {
          errorMap: () => ({
            message: "Role must be 'system', 'user', or 'assistant'.",
          }),
        }),
        content: z.string({
          required_error: "Message 'content' must be a plain string.",
          invalid_type_error: "Message 'content' must be a plain string. Multimodal formats are not supported in V1.",
        }).max(1_000_000),
        name: z.string().max(128).optional(),
      }),
      {
        required_error: "Missing required parameter 'messages'.",
      }
    )
    .min(1, "The 'messages' array cannot be empty.")
    .max(64, "The 'messages' array is too large."),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().optional(),
  n: z.number().optional(),
  user: z.string().max(128).optional(),
});

const sessionIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

export const registerChatCompletionsRoute = (
  localTaskQueue?: TaskQueue,
  extensionHub?: ExtensionHub
): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.post("/v1/chat/completions", async (request, reply) => {
      const startTime = Date.now();
      const requestId = `req_${crypto.randomBytes(6).toString("hex")}`;

      // 1. Validate payload schema
      const parseResult = chatCompletionSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw GatewayError.invalidRequest(
          parseResult.error.issues[0]?.message || "Invalid request payload."
        );
      }

      const body = parseResult.data;
      const rawBody = (request.body as Record<string, any>) || {};

      // 2. Reject unsupported OpenAI features
      if (rawBody.tools || rawBody.functions) {
        throw GatewayError.unsupportedFeature(
          "Tools and function calling are not supported in V1.",
          "tools_not_supported"
        );
      }
      if (body.n !== undefined && body.n > 1) {
        throw GatewayError.unsupportedFeature(
          "Parameter 'n' > 1 is not supported in V1.",
          "unsupported_parameter"
        );
      }

      // 3. Validate requested model
      const validatedModel = body.model;
      if (!isSupportedModel(validatedModel)) {
        throw GatewayError.unsupportedModel(
          body.model,
          SUPPORTED_MODELS.join(", ")
        );
      }

      // 4. Validate stream option (streaming not supported in V1)
      if (body.stream === true) {
        throw GatewayError.unsupportedFeature(
          "Streaming is not supported in V1.",
          "streaming_not_supported"
        );
      }

      // 5. Extract optional user / worker routing key
      const authHeader = request.headers["authorization"];
      let bearerToken: string | undefined;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        bearerToken = authHeader.slice(7).trim();
      }
      const userHeader =
        request.headers["x-geminicon-user-id"] ||
        request.headers["x-user-id"] ||
        request.headers["x-pairing-key"];
      let targetUserId = userHeader ? String(userHeader).trim() : undefined;
      if (!targetUserId && bearerToken && bearerToken !== "local" && bearerToken !== "none") {
        targetUserId = bearerToken;
      }

      // 6. Extract session options
      const sessionCandidate =
        request.headers["x-session-id"] || rawBody.session_id;
      const parsedSession = sessionCandidate === undefined
        ? undefined
        : sessionIdSchema.safeParse(sessionCandidate);
      if (parsedSession && !parsedSession.success) {
        throw GatewayError.invalidRequest("Invalid session ID.");
      }
      const sessionId = parsedSession?.data;

      const resetSession =
        request.headers["x-reset-session"] === "true" ||
        rawBody.reset_session === true;

      // 7. Determine target execution queue
      let targetQueue: TaskQueue | undefined;

      if (localTaskQueue) {
        targetQueue = localTaskQueue;
      } else if (targetUserId && extensionHub) {
        if (!extensionHub.hasWorker(targetUserId)) {
          throw GatewayError.workerNotConnected();
        }
        targetQueue = extensionHub.getUserQueue(targetUserId);
      } else if (extensionHub && extensionHub.getConnectedWorkerCount() > 1) {
        throw GatewayError.invalidRequest(
          "Multiple users configured. Please specify target worker."
        );
      } else if (extensionHub) {
        if (!extensionHub.hasWorker()) {
          throw GatewayError.workerNotConnected();
        }
        targetQueue = extensionHub.getUserQueue("default");
      } else {
        throw GatewayError.workerNotConnected(
          "No local browser or extension worker is connected to process requests."
        );
      }

      // 8. Normalize prompt
      const prompt = RequestNormalizer.normalize(
        body.messages as OpenAIMessage[]
      );
      if (Buffer.byteLength(prompt, "utf8") > 1_000_000) {
        throw GatewayError.invalidRequest("Normalized prompt is too large.");
      }

      // 9. Create GatewayTask
      const task: GatewayTask = {
        id: requestId,
        model: validatedModel,
        prompt,
        sessionId,
        resetSession,
        createdAt: Date.now(),
      };

      request.log.info({ requestId }, "Request queued");

      // 10. Attach cancellation handler for client disconnect
      const routingKey = targetUserId || "default";
      const onRequestAbort = () => {
        if (extensionHub) {
          extensionHub.cancelTask(routingKey, requestId);
        }
        if (localTaskQueue) {
          localTaskQueue.cancelQueued(
            requestId,
            GatewayError.internalError("Client disconnected.")
          );
        }
      };
      request.signal.addEventListener("abort", onRequestAbort, { once: true });

      // 11. Enqueue and await response
      let result;
      try {
        result = await targetQueue.enqueue(task);
      } finally {
        request.signal.removeEventListener("abort", onRequestAbort);
      }

      request.log.info(
        { requestId, latencyMs: result.latencyMs },
        "Generation completed"
      );

      // 12. Normalize response to OpenAI format
      const response = ResponseNormalizer.normalize(
        result,
        validatedModel,
        prompt
      );

      reply.header("X-Generation-Time-Ms", result.latencyMs);
      return reply.code(200).send(response);
    });
  };
};
