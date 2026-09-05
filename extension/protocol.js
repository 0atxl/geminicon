(function (root) {
  "use strict";

  const VERSION = 1;
  const ID = /^[A-Za-z0-9._:-]{1,128}$/;
  const MODELS = new Set(["gemini-web"]);
  const ERROR_TYPES = new Set([
    "invalid_request", "unsupported_model", "unsupported_feature",
    "authentication_required", "browser_unavailable", "gemini_unavailable",
    "temporary_chat_unavailable", "temporary_chat_failed", "worker_not_connected",
    "upstream_limit", "prompt_submission_failed", "response_extraction_failed",
    "generation_timeout", "task_cancelled", "upstream_error", "internal_error",
  ]);

  const allowedKeys = {
    REGISTER_ACK: ["type", "protocolVersion", "status", "message", "connectionId"],
    PING: ["type", "protocolVersion", "nonce"],
    PROBE_STATUS: ["type", "protocolVersion", "probeId"],
    EXECUTE_TASK: ["type", "protocolVersion", "taskId", "attemptId", "model", "prompt", "sessionId", "resetSession", "timeoutMs"],
    CANCEL_TASK: ["type", "protocolVersion", "taskId", "attemptId"],
  };

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function hasOnlyKeys(value, keys) {
    const allowed = new Set(keys);
    return Object.keys(value).every((key) => allowed.has(key));
  }

  function validEnvelope(value) {
    return value.protocolVersion === VERSION;
  }

  function parseServerMessage(value) {
    if (!isObject(value) || typeof value.type !== "string" || !allowedKeys[value.type] ||
        !hasOnlyKeys(value, allowedKeys[value.type]) || !validEnvelope(value)) {
      return null;
    }
    switch (value.type) {
      case "REGISTER_ACK":
        return (value.status === "ok" || value.status === "error") &&
          (value.message === undefined || (typeof value.message === "string" && value.message.length <= 256)) &&
          (value.connectionId === undefined || ID.test(value.connectionId)) ? value : null;
      case "PING":
        return ID.test(value.nonce) ? value : null;
      case "PROBE_STATUS":
        return ID.test(value.probeId) ? value : null;
      case "CANCEL_TASK":
        return ID.test(value.taskId) && ID.test(value.attemptId) ? value : null;
      case "EXECUTE_TASK":
        return ID.test(value.taskId) && ID.test(value.attemptId) &&
          MODELS.has(value.model) && typeof value.prompt === "string" && value.prompt.length <= 1024 * 1024 &&
          (value.sessionId === undefined || ID.test(value.sessionId)) &&
          (value.resetSession === undefined || typeof value.resetSession === "boolean") &&
          Number.isSafeInteger(value.timeoutMs) && value.timeoutMs >= 1000 && value.timeoutMs <= 30 * 60 * 1000
          ? value : null;
      default:
        return null;
    }
  }

  function message(type, fields) {
    return Object.assign({ type, protocolVersion: VERSION }, fields || {});
  }

  root.GeminiconProtocol = Object.freeze({
    VERSION,
    ERROR_TYPES,
    MODELS,
    parseServerMessage,
    message,
  });
})(globalThis);
