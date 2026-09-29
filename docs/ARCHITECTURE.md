# Architecture & Internal Design

Geminicon translates standard OpenAI Chat Completion requests into Google Gemini Web conversations.

```text
Client / App (OpenAI SDK / curl)
        │
        ▼ POST /v1/chat/completions (HTTP)
Fastify Gateway Server (port 8765)
        ├── Mode A: Chrome Extension Relay (Hub Mode, default)
        │     └── Outbound WebSocket (/ws)
        │           └── Background Chrome Worker
        │                 └── Silent background Gemini Tab (Temporary Chat)
        └── Mode B: Headless Playwright (Local Mode)
              └── Managed Chromium profile
```

---

## Operating Modes

### 1. Hub Mode (Chrome Extension Relay — Default)
* The gateway listens on `http://127.0.0.1:8765`.
* The Chrome extension connects via WebSocket to `ws://127.0.0.1:8765/ws`.
* When an inference request arrives, the server dispatches an `EXECUTE_TASK` protocol message.
* The extension's content script enters a **Temporary Chat** on `gemini.google.com`, submits the prompt, watches for generation completion, and returns the response.
* **Benefits:** Zero Google login maintenance on the server—uses whatever Google account is already logged into your regular Chrome browser.

### 2. Local Mode (Headless Playwright)
* Set `GEMINICON_MODE=local` in `.env`.
* Launches a local Playwright Chromium instance with persistent storage (`./browser-data/profile`).
* Does not require the Chrome extension.
* Good for automated background daemon setups where Chrome isn't kept running.

---

## Temporary Chat & Sessions

* **Default behavior:** Each request without a session ID activates a fresh **Temporary Chat** on Gemini Web. Conversations are not saved to your Google account chat sidebar.
* **Session continuity (`X-Session-ID`):** Reusing the same `X-Session-ID` keeps the same Temporary Chat open across multiple turns, enabling multi-turn memory without cluttering your chat history.
* **Force reset (`X-Reset-Session`):** Sending `X-Reset-Session: true` starts a fresh conversation even when reusing the same session ID.

---

## Safety & Rate Limits

* **Fail-Closed Execution:** Requests are sequentially queued per worker using an in-memory FIFO queue (`TaskQueue`).
* **Cancellation:** If an HTTP client disconnects mid-flight, an abort signal cancels prompt execution inside the browser tab immediately.
* **No DOM Pollution:** Generation occurs strictly inside dedicated tabs.
