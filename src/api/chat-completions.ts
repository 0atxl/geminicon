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
  extensionHub?: ExtensionHub,
  serviceKey?: string
): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.post("/v1/chat/completions", async (request, reply) => {
      const startTime = Date.now();
      const requestId = `req_${crypto.randomBytes(6).toString("hex")}`;

      // 1. Explicitly check for unsupported features in request body
      const rawBody = (request.body as Record<string, any>) || {};
      if (rawBody.tools || rawBody.functions || rawBody.tool_choice) {
        throw GatewayError.unsupportedFeature(
          "Function and tool calling are not supported in V1.",
          "tools_not_supported"
        );
      }

      if (rawBody.n && typeof rawBody.n === "number" && rawBody.n > 1) {
        throw GatewayError.unsupportedFeature(
          "Parameter 'n' > 1 is not supported in V1.",
          "unsupported_parameter"
        );
      }

      // 2. Validate request body against schema
      const parseResult = chatCompletionSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        throw GatewayError.invalidRequest(
          firstIssue?.message || "Invalid request payload."
        );
      }

      const body = parseResult.data;

      // 3. Accept only models whose selection is positively verifiable.
      if (!isSupportedModel(body.model)) {
        throw GatewayError.unsupportedModel(
          body.model,
          SUPPORTED_MODELS.join(", ")
        );
      }

      // 4. Validate stream option (must explicitly reject with streaming_not_supported)
      if (body.stream === true) {
        throw GatewayError.unsupportedFeature(
          "Streaming is not supported in V1.",
          "streaming_not_supported"
        );
      }

      // 5. Authentication & Service Key Validation
      const authHeader = request.headers["authorization"];
      let bearerToken: string | undefined;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        bearerToken = authHeader.slice(7).trim();
      }

      // The device token must NOT authorize generation API calls
      if (bearerToken && bearerToken.startsWith("gcon_dev_")) {
        throw GatewayError.unauthorized(
          "Device tokens cannot authorize generation API calls. A service key is required.",
          "device_token_not_allowed"
        );
      }

      // Validate service key if configured
      if (serviceKey) {
        if (!bearerToken || bearerToken !== serviceKey) {
          throw GatewayError.unauthorized(
            "Unauthorized: Valid service key required."
          );
        }
      }

      // 6. Extract User ID for routing
      const userHeader =
        request.headers["x-geminicon-user-id"] ||
        request.headers["x-user-id"] ||
        request.headers["x-pairing-key"];
      let targetUserId = userHeader ? String(userHeader).trim() : undefined;

      // Backward compatibility: if no serviceKey configured and a non-dummy bearer token is passed
      if (!targetUserId && bearerToken && !serviceKey && bearerToken !== "local" && bearerToken !== "none") {
        targetUserId = bearerToken;
      }

      // 7. Extract session options
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

      // 8. Determine target execution queue
      let targetQueue: TaskQueue | undefined;

      if (localTaskQueue) {
        targetQueue = localTaskQueue;
      } else if (targetUserId && extensionHub) {
        if (!extensionHub.hasWorker(targetUserId)) {
          throw GatewayError.workerNotConnected();
        }
        targetQueue = extensionHub.getUserQueue(targetUserId);
      } else if (extensionHub && extensionHub.getConnectedWorkerCount() > 0) {
        throw GatewayError.invalidRequest(
          "Multiple users configured. Please provide 'X-Geminicon-User-ID: <userId>'."
        );
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

      // 9. Create internal task
      const task: GatewayTask = {
        id: requestId,
        model: body.model,
        prompt,
        createdAt: startTime,
        sessionId,
        resetSession,
      };

      if (config.logContent) {
        fastify.log.info(
          { requestId, prompt },
          "Submitting prompt to queue"
        );
      } else {
        fastify.log.info({ requestId }, "Request queued");
      }

      // Fastify's signal is aborted only for an actual client disconnect. A
      // normal IncomingMessage 'close' also fires after successful requests.
      const onRequestAbort = () => {
        if (targetUserId && extensionHub) {
          extensionHub.cancelTask(targetUserId, requestId);
        }
        if (localTaskQueue) {
          localTaskQueue.cancelQueued(
            requestId,
            GatewayError.internalError("Client disconnected.")
          );
        }
      };
      request.signal.addEventListener("abort", onRequestAbort, { once: true });

      // 10. Enqueue task for sequential execution in user's queue
      let workerResult;
      try {
        workerResult = await targetQueue.enqueue(task);
      } finally {
        request.signal.removeEventListener("abort", onRequestAbort);
      }

      if (config.logContent) {
        fastify.log.info(
          {
            requestId,
            latencyMs: workerResult.latencyMs,
            response: workerResult.text,
          },
          "Generation completed"
        );
      } else {
        fastify.log.info(
          { requestId, latencyMs: workerResult.latencyMs },
          "Generation completed"
        );
      }

      // 11. Format OpenAI-compatible response
      const response = ResponseNormalizer.normalize(workerResult, task.model);

      return reply.code(200).send(response);
    });
  };
};
