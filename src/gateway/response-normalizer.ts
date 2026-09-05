import { OpenAIChatResponse, SupportedModel, WorkerResult } from "../types.js";

export class ResponseNormalizer {
  /**
   * Normalizes a WorkerResult into standard OpenAI Chat Completion JSON format.
   */
  public static normalize(
    result: WorkerResult,
    model: SupportedModel = "gemini-web"
  ): OpenAIChatResponse {
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
    };
  }
}
