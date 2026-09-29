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
  n?: number;
  user?: string;
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

// Until model selection can be verified against the live Gemini UI, the
// public contract intentionally exposes only the UI-selected default model.
export type SupportedModel = "gemini-web";

export const SUPPORTED_MODELS = ["gemini-web"] as const;

export function isSupportedModel(value: string): value is SupportedModel {
  return SUPPORTED_MODELS.some((model) => model === value);
}

export interface GatewayTask {
  id: string;
  model: SupportedModel;
  prompt: string;
  createdAt: number;
  sessionId?: string;
  resetSession?: boolean;
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
  | "temporary_chat_unavailable"
  | "temporary_chat_failed"
  | "worker_not_connected"
  | "upstream_limit"
  | "prompt_submission_failed"
  | "response_extraction_failed"
  | "generation_timeout"
  | "task_cancelled"
  | "upstream_error"
  | "internal_error";

export const GATEWAY_ERROR_CODES = [
  "invalid_request",
  "unsupported_model",
  "unsupported_feature",
  "authentication_required",
  "browser_unavailable",
  "gemini_unavailable",
  "temporary_chat_unavailable",
  "temporary_chat_failed",
  "worker_not_connected",
  "upstream_limit",
  "prompt_submission_failed",
  "response_extraction_failed",
  "generation_timeout",
  "task_cancelled",
  "upstream_error",
  "internal_error",
] as const satisfies readonly GatewayErrorCode[];

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
  connectedWorkers?: number;
  readyWorkers?: number;
}

export interface ModelsResponse {
  object: "list";
  data: Array<{
    id: SupportedModel;
    object: "model";
    owned_by: string;
  }>;
}

export const GEMINICON_PROTOCOL_VERSION = 1 as const;

type ProtocolEnvelope = {
  protocolVersion: typeof GEMINICON_PROTOCOL_VERSION;
};

// WebSocket protocol between the server hub and Chrome extension worker.
export type WSClientMessage =
  | (ProtocolEnvelope & {
      type: "REGISTER";
      deviceToken?: string;
      credential?: string;
      deviceId: string;
      name?: string;
      clientVersion: string;
    })
  | (ProtocolEnvelope & { type: "PONG"; nonce: string })
  | (ProtocolEnvelope & {
      type: "TASK_COMPLETE";
      taskId: string;
      attemptId: string;
      text: string;
      latencyMs: number;
    })
  | (ProtocolEnvelope & {
      type: "TASK_ERROR";
      taskId: string;
      attemptId: string;
      errorType: GatewayErrorCode;
      message: string;
    })
  | (ProtocolEnvelope & {
      type: "TASK_CANCELLED";
      taskId: string;
      attemptId: string;
      ready: boolean;
    })
  | (ProtocolEnvelope & {
      type: "DEVICE_STATUS";
      probeId: string;
      status: "ready" | "connected_not_ready";
      geminiAuthenticated: boolean;
      contentScriptResponsive: boolean;
      temporaryChatAvailable: boolean;
      models: SupportedModel[];
    });

export type WSServerMessage =
  | (ProtocolEnvelope & {
      type: "REGISTER_ACK";
      status: "ok" | "error";
      message?: string;
      connectionId?: string;
    })
  | (ProtocolEnvelope & { type: "PING"; nonce: string })
  | (ProtocolEnvelope & {
      type: "PROBE_STATUS";
      probeId: string;
    })
  | (ProtocolEnvelope & {
      type: "EXECUTE_TASK";
      taskId: string;
      attemptId: string;
      model: SupportedModel;
      prompt: string;
      sessionId?: string;
      resetSession?: boolean;
      timeoutMs: number;
    })
  | (ProtocolEnvelope & {
      type: "CANCEL_TASK";
      taskId: string;
      attemptId: string;
    });
