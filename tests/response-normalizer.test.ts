import { describe, it, expect } from "vitest";
import { ResponseNormalizer } from "../src/gateway/response-normalizer.js";

describe("ResponseNormalizer", () => {
  it("should normalize WorkerResult into valid OpenAI chat completion structure", () => {
    const workerResult = {
      requestId: "req_01JXYZ",
      text: "TCP congestion control operates using slow start and congestion avoidance.",
      latencyMs: 1250,
    };

    const response = ResponseNormalizer.normalize(workerResult, "gemini-web");

    expect(response).toEqual({
      id: "chatcmpl-req_01JXYZ",
      object: "chat.completion",
      created: expect.any(Number),
      model: "gemini-web",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "TCP congestion control operates using slow start and congestion avoidance.",
          },
          finish_reason: "stop",
        },
      ],
    });
    expect(response.created).toBeGreaterThan(1700000000);
  });

  it("should handle empty string response gracefully", () => {
    const workerResult = {
      requestId: "req_empty",
      text: "",
      latencyMs: 100,
    };

    const response = ResponseNormalizer.normalize(workerResult, "gemini-web");
    expect(response.choices[0].message.content).toBe("");
    expect(response.model).toBe("gemini-web");
  });

  it("should handle multiline, codeblocks, and unicode characters correctly", () => {
    const complexText = "```json\n{\"key\": \"🚀 value \u00A9 2026\"}\n```\n\n- Point 1\n- Point 2";
    const workerResult = {
      requestId: "req_unicode",
      text: complexText,
      latencyMs: 500,
    };

    const response = ResponseNormalizer.normalize(workerResult, "gemini-web");
    expect(response.choices[0].message.content).toBe(complexText);
    expect(response.model).toBe("gemini-web");
  });
});
