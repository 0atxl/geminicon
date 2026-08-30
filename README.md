# geminicon — Minimal Gemini Web Gateway (V1)

A minimal local browser-backed Gemini Web gateway exposing a basic OpenAI Chat Completions-compatible text interface.

---

## Architecture

```text
Client / RAG / Chatbot
        │
        ▼
POST /v1/chat/completions
        │
        ▼
Fastify HTTP Gateway
        │
        ▼
Request validation
        │
        ▼
Request normalization
        │
        ▼
FIFO Queue (concurrency = 1)
        │
        ▼
Gemini Web Worker
        │
        ▼
Browser Manager
        │
        ▼
Playwright Chromium (persistent browser profile)
        │
        ▼
gemini.google.com
        │
        ▼
submit prompt
        │
        ▼
wait for generation
        │
        ▼
extract final response
        │
        ▼
Response normalizer
        │
        ▼
OpenAI-compatible JSON
        │
        ▼
Client
```

---

## Prerequisites

- **Node.js**: v18 or newer
- **Playwright Chromium**: installed via `npx playwright install chromium`

---

## Setup & First-Time Login

### 1. Install Dependencies
```bash
npm install
npx playwright install chromium
```

### 2. First-Time Authentication (One-Time Setup)

To log into your Google Account for Gemini Web:

1. Create your `.env` file:
   ```bash
   cp .env.example .env
   ```
2. Set `HEADLESS=false` in `.env`:
   ```env
   HEADLESS=false
   ```
3. Start the gateway:
   ```bash
   npm start
   ```
4. A Chromium browser window will open at `https://gemini.google.com/app`. Log into your Google Account normally.
5. Once logged in and the Gemini interface is visible, stop the gateway (`Ctrl+C`).
6. Switch back to `HEADLESS=true` in `.env` for background operation.

The session is persisted locally in `./browser-data/profile`.

### 3. Normal Operation

```bash
npm start
```

Default endpoint: `http://127.0.0.1:8765`

---

## Usage Examples

### cURL

```bash
curl http://127.0.0.1:8765/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-web",
    "messages": [
      {
        "role": "system",
        "content": "Answer using only the supplied context."
      },
      {
        "role": "user",
        "content": "Where is the server hosted?"
      }
    ]
  }'
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8765/v1",
    api_key="local"  # Required by SDK, ignored by gateway
)

response = client.chat.completions.create(
    model="gemini-web",
    messages=[
        {"role": "system", "content": "Answer concisely based on provided context."},
        {"role": "user", "content": "Explain TCP congestion control."}
    ]
)

print(response.choices[0].message.content)
```

### Node.js / TypeScript (OpenAI SDK)

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:8765/v1",
  apiKey: "local",
});

async function main() {
  const response = await client.chat.completions.create({
    model: "gemini-web",
    messages: [
      { role: "user", content: "What is the difference between a process and a thread?" },
    ],
  });

  console.log(response.choices[0].message.content);
}

main();
```

---

## Supported Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/v1/chat/completions` | Text chat completions for model `gemini-web` (non-streaming) |
| `GET` | `/v1/models` | Lists available model (`gemini-web`) |
| `GET` | `/health` | Live readiness status of the browser and Gemini Web session |

---

## Health Endpoint

`GET /health` returns:

* **Healthy (HTTP 200)**:
  ```json
  { "status": "ok", "browser": "ready", "gemini": "ready" }
  ```
* **Authentication Required (HTTP 503)**:
  ```json
  { "status": "degraded", "browser": "ready", "gemini": "authentication_required" }
  ```
* **Gemini Unavailable (HTTP 503)**:
  ```json
  { "status": "degraded", "browser": "ready", "gemini": "unavailable" }
  ```
* **Browser Unavailable (HTTP 503)**:
  ```json
  { "status": "error", "browser": "unavailable", "gemini": "unknown" }
  ```

---

## Configuration (`.env`)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `HOST` | `127.0.0.1` | HTTP server bind address |
| `PORT` | `8765` | HTTP server port |
| `HEADLESS` | `true` | Run Chromium in headless mode |
| `BROWSER_PROFILE_PATH` | `./browser-data/profile` | Directory storing persistent Google browser profile |
| `GENERATION_TIMEOUT_MS` | `180000` | Max wait time for Gemini response (ms) |
| `QUEUE_MAX_SIZE` | `20` | Max pending tasks in queue before returning HTTP 429 |
| `USE_TEMPORARY_CHAT` | `true` | Automatically enable Temporary Chat mode so requests do not appear in recent sidebar history |
| `LOG_LEVEL` | `info` | Fastify / Pino log level |
| `LOG_CONTENT` | `false` | When true, logs prompt and response content for local debugging |

---

## Known Limitations

* **Web UI Dependent**: Relies on `gemini.google.com` web DOM. Future Google UI updates may require selector adjustments in `src/providers/gemini-web/selectors.ts`.
* **Sequential Concurrency**: Requests are processed strictly one at a time (`concurrency = 1`) to ensure stable browser state.
* **No Streaming in V1**: Streaming (`stream: true`) is rejected with HTTP 400.
* **No Function Calling / Tools**: V1 supports text inference only.
* **No Multimodal Input**: Plain text strings only.
* **No Token Accounting**: `usage` object is omitted rather than fabricating synthetic counts.
* **Session Required**: Requires a valid, logged-in Google Account session in the persistent profile.
* **Service Limits**: Standard Google Gemini Web rate limits and usage conditions apply.

---

## Development & Testing

```bash
# Run unit tests
npm test

# Typecheck
npm run typecheck

# Build TypeScript to dist/
npm run build
```
