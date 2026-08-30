import { describe, it, expect } from "vitest";
import { GatewayError } from "../src/gateway/errors.js";

describe("GatewayError", () => {
  it("should format invalidRequest correctly with HTTP 400", () => {
    const err = GatewayError.invalidRequest("Bad input");
    expect(err.statusCode).toBe(400);
    expect(err.errorType).toBe("invalid_request");
    expect(err.code).toBe("invalid_request");
    expect(err.toPayload()).toEqual({
      error: {
        message: "Bad input",
        type: "invalid_request",
        code: "invalid_request",
      },
    });
  });

  it("should format unsupportedModel correctly with HTTP 400", () => {
    const err = GatewayError.unsupportedModel("gpt-4");
    expect(err.statusCode).toBe(400);
    expect(err.errorType).toBe("unsupported_model");
    expect(err.code).toBe("unsupported_model");
  });

  it("should format unsupportedFeature correctly with HTTP 400 and custom code", () => {
    const err = GatewayError.unsupportedFeature(
      "Streaming is not supported in V1.",
      "streaming_not_supported"
    );
    expect(err.statusCode).toBe(400);
    expect(err.errorType).toBe("unsupported_feature");
    expect(err.code).toBe("streaming_not_supported");
  });

  it("should format queueFull correctly with HTTP 429", () => {
    const err = GatewayError.queueFull();
    expect(err.statusCode).toBe(429);
    expect(err.errorType).toBe("queue_full");
  });

  it("should format authenticationRequired correctly with HTTP 503", () => {
    const err = GatewayError.authenticationRequired();
    expect(err.statusCode).toBe(503);
    expect(err.errorType).toBe("authentication_required");
  });

  it("should format browserUnavailable correctly with HTTP 503", () => {
    const err = GatewayError.browserUnavailable();
    expect(err.statusCode).toBe(503);
    expect(err.errorType).toBe("browser_unavailable");
  });

  it("should format geminiUnavailable correctly with HTTP 503", () => {
    const err = GatewayError.geminiUnavailable();
    expect(err.statusCode).toBe(503);
    expect(err.errorType).toBe("gemini_unavailable");
  });

  it("should format temporaryChatUnavailable correctly with HTTP 502", () => {
    const err = GatewayError.temporaryChatUnavailable();
    expect(err.statusCode).toBe(502);
    expect(err.errorType).toBe("temporary_chat_unavailable");
    expect(err.code).toBe("temporary_chat_unavailable");
  });

  it("should format temporaryChatFailed correctly with HTTP 502", () => {
    const err = GatewayError.temporaryChatFailed();
    expect(err.statusCode).toBe(502);
    expect(err.errorType).toBe("temporary_chat_failed");
    expect(err.code).toBe("gemini_temporary_chat_failed");
  });

  it("should format upstreamLimit correctly with HTTP 429", () => {
    const err = GatewayError.upstreamLimit();
    expect(err.statusCode).toBe(429);
    expect(err.errorType).toBe("upstream_limit");
  });

  it("should format promptSubmissionFailed correctly with HTTP 502", () => {
    const err = GatewayError.promptSubmissionFailed();
    expect(err.statusCode).toBe(502);
    expect(err.errorType).toBe("prompt_submission_failed");
  });

  it("should format responseExtractionFailed correctly with HTTP 502", () => {
    const err = GatewayError.responseExtractionFailed();
    expect(err.statusCode).toBe(502);
    expect(err.errorType).toBe("response_extraction_failed");
  });

  it("should format generationTimeout correctly with HTTP 504", () => {
    const err = GatewayError.generationTimeout();
    expect(err.statusCode).toBe(504);
    expect(err.errorType).toBe("generation_timeout");
    expect(err.code).toBe("gemini_generation_timeout");
  });

  it("should format upstreamError correctly with HTTP 502", () => {
    const err = GatewayError.upstreamError();
    expect(err.statusCode).toBe(502);
    expect(err.errorType).toBe("upstream_error");
  });

  it("should format internalError correctly with HTTP 500", () => {
    const err = GatewayError.internalError();
    expect(err.statusCode).toBe(500);
    expect(err.errorType).toBe("internal_error");
  });
});
