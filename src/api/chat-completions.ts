import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import { GatewayTask, OpenAIMessage } from "../types.js";
import { GatewayError } from "../gateway/errors.js";
import { RequestNormalizer } from "../gateway/request-normalizer.js";
import { ResponseNormalizer } from "../gateway/response-normalizer.js";
import { TaskQueue } from "../queue/task-queue.js";

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
          required_error: "Message 'content' must be a string.",
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

      // 3. Validate stream option
      if (body.stream === true) {
        throw GatewayError.unsupportedFeature(
          "Streaming is not supported in V1."
        );
      }

      // 4. Normalize prompt
      const prompt = RequestNormalizer.normalize(
        body.messages as OpenAIMessage[]
      );

      // 5. Create internal task
      const taskId = `req_${crypto.randomBytes(6).toString("hex")}`;
      const task: GatewayTask = {
        id: taskId,
        model: "gemini-web",
        prompt,
        createdAt: Date.now(),
      };

      // 6. Enqueue task for sequential execution
      const workerResult = await taskQueue.enqueue(task);

      // 7. Format OpenAI-compatible response
      const response = ResponseNormalizer.normalize(workerResult);

      return reply.code(200).send(response);
    });
  };
};
