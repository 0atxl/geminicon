import { GatewayErrorCode, GatewayErrorPayload } from "../types.js";

export class GatewayError extends Error {
  public readonly statusCode: number;
  public readonly errorType: GatewayErrorCode;
  public readonly code?: string;

  constructor(
    message: string,
    errorType: GatewayErrorCode = "internal_error",
    statusCode = 500,
    code?: string
  ) {
    super(message);
    this.name = "GatewayError";
    this.errorType = errorType;
    this.statusCode = statusCode;
    this.code = code || errorType;
    Object.setPrototypeOf(this, GatewayError.prototype);
  }

  public toPayload(): GatewayErrorPayload {
    return {
      error: {
        message: this.message,
        type: this.errorType,
        ...(this.code ? { code: this.code } : {}),
      },
    };
  }

  public static invalidRequest(
    message: string,
    code = "invalid_request"
  ): GatewayError {
    return new GatewayError(message, "invalid_request", 400, code);
  }

  public static unsupportedModel(
    model: string,
    supported = "gemini-web"
  ): GatewayError {
    return new GatewayError(
      `Model '${model}' is not supported. Supported model is '${supported}'.`,
      "unsupported_model",
      400,
      "unsupported_model"
    );
  }

  public static unsupportedFeature(
    message: string,
    code = "unsupported_feature"
  ): GatewayError {
    return new GatewayError(message, "unsupported_feature", 400, code);
  }

  public static queueFull(
    message = "Task queue is full. Please try again later."
  ): GatewayError {
    return new GatewayError(message, "queue_full", 429, "queue_full");
  }

  public static authenticationRequired(
    message = "Gemini Web authentication is required. Please log into Google Gemini using the browser profile."
  ): GatewayError {
    return new GatewayError(
      message,
      "authentication_required",
      503,
      "authentication_required"
    );
  }

  public static browserUnavailable(
    message = "Playwright browser instance is unavailable."
  ): GatewayError {
    return new GatewayError(
      message,
      "browser_unavailable",
      503,
      "browser_unavailable"
    );
  }

  public static geminiUnavailable(
    message = "Gemini Web page is unavailable."
  ): GatewayError {
    return new GatewayError(
      message,
      "gemini_unavailable",
      503,
      "gemini_unavailable"
    );
  }

  public static temporaryChatUnavailable(
    message = "Gemini Temporary Chat control was not found. Never falling back to normal chat."
  ): GatewayError {
    return new GatewayError(
      message,
      "temporary_chat_unavailable",
      502,
      "temporary_chat_unavailable"
    );
  }

  public static temporaryChatFailed(
    message = "Gemini Temporary Chat could not be activated."
  ): GatewayError {
    return new GatewayError(
      message,
      "temporary_chat_failed",
      502,
      "gemini_temporary_chat_failed"
    );
  }

  public static upstreamLimit(
    message = "Upstream Gemini Web rate limit or usage condition reached."
  ): GatewayError {
    return new GatewayError(message, "upstream_limit", 429, "upstream_limit");
  }

  public static promptSubmissionFailed(
    message = "Failed to insert or submit prompt to Gemini Web composer."
  ): GatewayError {
    return new GatewayError(
      message,
      "prompt_submission_failed",
      502,
      "prompt_submission_failed"
    );
  }

  public static responseExtractionFailed(
    message = "Failed to extract generated response text from Gemini Web page."
  ): GatewayError {
    return new GatewayError(
      message,
      "response_extraction_failed",
      502,
      "response_extraction_failed"
    );
  }

  public static generationTimeout(
    message = "Gemini did not complete generation within the configured timeout."
  ): GatewayError {
    return new GatewayError(
      message,
      "generation_timeout",
      504,
      "gemini_generation_timeout"
    );
  }

  public static upstreamError(
    message = "Upstream Gemini Web error encountered."
  ): GatewayError {
    return new GatewayError(message, "upstream_error", 502, "upstream_error");
  }

  public static internalError(
    message = "An internal gateway error occurred."
  ): GatewayError {
    return new GatewayError(message, "internal_error", 500, "internal_error");
  }
}
