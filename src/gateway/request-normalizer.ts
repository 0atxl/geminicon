import { OpenAIMessage } from "../types.js";
import { GatewayError } from "./errors.js";

export class RequestNormalizer {
  /**
   * Normalizes an array of OpenAI messages into a single prompt for Gemini Web.
   */
  public static normalize(messages: OpenAIMessage[]): string {
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw GatewayError.invalidRequest(
        "Invalid request: 'messages' array must not be empty."
      );
    }

    const systemMessages: string[] = [];
    const nonSystemMessages: OpenAIMessage[] = [];

    for (const msg of messages) {
      if (!msg || typeof msg.content !== "string") {
        throw GatewayError.invalidRequest(
          "Invalid message: 'content' must be a string."
        );
      }

      if (msg.role === "system") {
        const trimmed = msg.content.trim();
        if (trimmed) {
          systemMessages.push(trimmed);
        }
      } else if (msg.role === "user" || msg.role === "assistant") {
        nonSystemMessages.push(msg);
      } else {
        throw GatewayError.invalidRequest(
          `Invalid message role '${(msg as any).role}'. Supported roles are: 'system', 'user', 'assistant'.`
        );
      }
    }

    if (nonSystemMessages.length === 0) {
      throw GatewayError.invalidRequest(
        "Invalid request: at least one 'user' message is required."
      );
    }

    const systemInstructions = systemMessages.join("\n\n");

    // Case 1: Single user turn and no system instruction
    if (nonSystemMessages.length === 1 && !systemInstructions) {
      return nonSystemMessages[0].content;
    }

    // Case 2: Single user turn with system instruction
    if (nonSystemMessages.length === 1 && systemInstructions) {
      return `SYSTEM INSTRUCTIONS\n\n${systemInstructions}\n\nUSER\n\n${nonSystemMessages[0].content}`;
    }

    // Case 3: Multi-turn conversation
    const conversationTurns = nonSystemMessages.map((m) => {
      const roleLabel = m.role === "assistant" ? "ASSISTANT" : "USER";
      return `${roleLabel}:\n${m.content}`;
    });

    const conversationText = conversationTurns.join("\n\n");

    if (systemInstructions) {
      return `SYSTEM INSTRUCTIONS\n\n${systemInstructions}\n\n${conversationText}`;
    }

    return conversationText;
  }
}
