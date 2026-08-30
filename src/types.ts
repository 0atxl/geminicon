export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
  name?: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface OpenAIChatChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: "stop" | "length" | "content_filter";
}

export interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface GatewayTask {
  id: string;
  model: "gemini-web";
  prompt: string;
  createdAt: number;
}

export interface WorkerResult {
  requestId: string;
  text: string;
  latencyMs: number;
}

export type GatewayErrorCode =
  | "invalid_request"
  | "unsupported_model"
  | "unsupported_feature"
  | "queue_full"
  | "authentication_required"
  | "browser_unavailable"
  | "gemini_unavailable"
  | "upstream_limit"
  | "prompt_submission_failed"
  | "response_extraction_failed"
  | "generation_timeout"
  | "upstream_error"
  | "internal_error";

export interface GatewayErrorPayload {
  error: {
    message: string;
    type: GatewayErrorCode;
    code?: string;
  };
}

export interface HealthStatus {
  status: "ok" | "degraded" | "error";
  browser: "ready" | "unavailable";
  gemini: "ready" | "authentication_required" | "unavailable" | "unknown";
}

export interface ModelsResponse {
  object: "list";
  data: Array<{
    id: string;
    object: "model";
    owned_by: string;
  }>;
}
