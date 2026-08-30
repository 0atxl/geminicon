export interface BrowserHealthStatus {
  browser: "ready" | "unavailable";
  gemini: "ready" | "authentication_required" | "unavailable";
}

export interface GeminiPageOptions {
  timeoutMs: number;
}
