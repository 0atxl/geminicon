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
  });
});
