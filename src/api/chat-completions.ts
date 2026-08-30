import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import { GatewayTask, OpenAIMessage } from "../types.js";
import { GatewayError } from "../gateway/errors.js";
import { RequestNormalizer } from "../gateway/request-normalizer.js";
import { ResponseNormalizer } from "../gateway/response-normalizer.js";
import { TaskQueue } from "../queue/task-queue.js";
import { config } from "../config.js";

const chatCompletionSchema = z.object({
  model: z.string({
    required_error: "Missing required parameter 'model'.",
  }),
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
        }),
        name: z.string().optional(),
      }),
      {
        required_error: "Missing required parameter 'messages'.",
      }
    )
    .min(1, "The 'messages' array cannot be empty."),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().optional(),
});

export const registerChatCompletionsRoute = (
  taskQueue: TaskQueue
): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.post("/v1/chat/completions", async (request, reply) => {
      const startTime = Date.now();
      const requestId = `req_${crypto.randomBytes(6).toString("hex")}`;

      // 1. Validate request body against schema
      const parseResult = chatCompletionSchema.safeParse(request.body);
      if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        throw GatewayError.invalidRequest(
          firstIssue?.message || "Invalid request payload."
        );
      }

      const body = parseResult.data;

      // 2. Validate model
      if (body.model !== "gemini-web") {
        throw GatewayError.unsupportedModel(body.model);
      }

      // 3. Validate stream option (must explicitly reject with streaming_not_supported)
      if (body.stream === true) {
        throw GatewayError.unsupportedFeature(
          "Streaming is not supported in V1.",
          "streaming_not_supported"
        );
      }

      // 4. Normalize prompt
      const prompt = RequestNormalizer.normalize(
        body.messages as OpenAIMessage[]
      );

      // 5. Create internal task
      const task: GatewayTask = {
        id: requestId,
        model: "gemini-web",
        prompt,
        createdAt: startTime,
      };

      if (config.logContent) {
        fastify.log.info({ requestId, prompt }, "Submitting prompt to queue");
      } else {
        fastify.log.info({ requestId }, "Request queued");
      }

      // 6. Enqueue task for sequential execution
      const workerResult = await taskQueue.enqueue(task);

      if (config.logContent) {
        fastify.log.info(
          { requestId, latencyMs: workerResult.latencyMs, response: workerResult.text },
          "Generation completed"
        );
      } else {
        fastify.log.info(
          { requestId, latencyMs: workerResult.latencyMs },
          "Generation completed"
        );
      }

      // 7. Format OpenAI-compatible response
      const response = ResponseNormalizer.normalize(workerResult);

      return reply.code(200).send(response);
    });
  };
};
