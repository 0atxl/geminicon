import { OpenAIChatResponse, SupportedModel, WorkerResult } from "../types.js";

export class ResponseNormalizer {
  /**
   * Normalizes a WorkerResult into standard OpenAI Chat Completion JSON format.
   */
  public static normalize(
    result: WorkerResult,
    model: SupportedModel = "gemini-web",
    prompt?: string
  ): OpenAIChatResponse {
    const promptTokens = prompt ? Math.max(1, Math.ceil(prompt.length / 4)) : 0;
    const completionTokens =
      result.text.length > 0 ? Math.max(1, Math.ceil(result.text.length / 4)) : 0;

    return {
      id: `chatcmpl-${result.requestId}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: result.text,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }
}
