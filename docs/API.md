# API Reference

Geminicon exposes a standard OpenAI-compatible API on `http://127.0.0.1:8765/v1`.

---

## 1. Chat Completions

### `POST /v1/chat/completions`

Translates standard OpenAI Chat Completion requests to Gemini Web.

#### Headers
* `Content-Type: application/json`
* `X-Session-ID: <string>` *(Optional)*: Enables multi-turn conversation memory.
* `X-Reset-Session: true` *(Optional)*: Forces a fresh chat session.

#### Request Body
```json
{
  "model": "gemini-web",
  "messages": [
    { "role": "system", "content": "You are a helpful coding assistant." },
    { "role": "user", "content": "Write a binary search in TypeScript." }
  ],
  "session_id": "optional_session_1",
  "reset_session": false
}
```

#### Parameters
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `model` | string | **Yes** | Must be `"gemini-web"`. |
| `messages` | array | **Yes** | Standard OpenAI message objects (`role`: `system` \| `user` \| `assistant`, `content`: `string`). |
| `session_id` | string | No | Body alternative to `X-Session-ID`. |
| `reset_session` | boolean | No | Body alternative to `X-Reset-Session`. |
| `response_format` | object | No | `{ "type": "json_object" }` or `{ "type": "text" }`. |
| `stream` | boolean | No | Set to `false` or omit. Streaming is not supported in V1. |

#### Response (200 OK)
```json
{
  "id": "chatcmpl-req_123456abcdef",
  "object": "chat.completion",
  "created": 1790676518,
  "model": "gemini-web",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Here is the binary search implementation..."
      },
      "finish_reason": "stop"
    }
  ]
}
```

---

## 2. Model List

### `GET /v1/models`

Returns verified supported models.

#### Response (200 OK)
```json
{
  "object": "list",
  "data": [
    {
      "id": "gemini-web",
      "object": "model",
      "created": 1700000000,
      "owned_by": "google"
    }
  ]
}
```

---

## 3. Health Check

### `GET /health`

Returns live worker and browser readiness status.

#### Response (200 OK)
```json
{
  "status": "ok",
  "browser": "disabled (hub mode)",
  "connectedWorkers": 1,
  "readyWorkers": 1
}
```

---

## 4. Error Codes

| HTTP Status | Error Type | Code | Description |
| :--- | :--- | :--- | :--- |
| 400 | `invalid_request` | `invalid_request` | Malformed JSON body or invalid parameter. |
| 400 | `unsupported_model` | `unsupported_model` | Model name was not `"gemini-web"`. |
| 400 | `unsupported_feature` | `streaming_not_supported` | `stream: true` is not supported. |
| 429 | `upstream_limit` | `upstream_limit` | Google Gemini reported a rate limit on the web UI. |
| 499 | `task_cancelled` | `task_cancelled` | Client aborted the request before completion. |
| 503 | `worker_not_connected` | `worker_not_connected` | No Chrome extension or Playwright worker is connected. |
| 503 | `authentication_required` | `authentication_required` | Google account session on Gemini Web expired. |
