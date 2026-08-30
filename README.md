# Gemini Web Gateway — Minimal V1

A minimal local OpenAI-compatible HTTP gateway that bridges requests to **Google Gemini Web** via an automated **Playwright Chromium browser worker** using a persistent user profile.

---

## Architecture

```text
Your Application (OpenAI SDK / LangChain / RAG)
                      │
                      │ POST /v1/chat/completions
                      ▼
            Gemini Web Gateway (Fastify)
                      │
                      ▼
               Task Queue (FIFO, concurrency = 1)
                      │
                      ▼
          Playwright Browser Worker (Persistent Chromium)
                      │
                      ▼
              gemini.google.com/app
                      │
                      ▼
             Extract Response Text
                      │
                      ▼
            OpenAI-Compatible JSON
                      │
                      ▼
               Your Application
```

---

## Features

- **100% OpenAI API Compatible**: Exposes standard `POST /v1/chat/completions` and `GET /v1/models`.
- **Zero API Key Needed**: Leverages your logged-in Google Gemini browser session.
- **Stateless & Fresh**: Opens a fresh chat on Gemini per request; your application manages conversation history.
- **Strict Concurrency (1)**: Uses an in-process FIFO task queue to eliminate race conditions and browser state collision.
- **Zero Fallbacks / Fakes**: Never returns synthetic responses. Explicit errors on failures.

---

## Prerequisites

- **Node.js**: v18 or newer
- **Playwright Chromium**: installed via `npx playwright install chromium`

---

## Quickstart

### 1. Install Dependencies
```bash
npm install
npx playwright install chromium
```

### 2. First-Time Authentication (One-Time Setup)

To log into your Google Account for Gemini Web:

1. Create a `.env` file (or copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```
2. Temporarily set `HEADLESS=false` in `.env`:
   ```env
   HEADLESS=false
   ```
3. Start the gateway:
   ```bash
   npm start
   ```
4. A Chromium window will open at `https://gemini.google.com/app`. Log into your Google Account.
5. Once logged in, stop the gateway (`Ctrl+C`) and switch back to `HEADLESS=true` in `.env`.

The session is stored persistently in `./browser-data/profile`.

### 3. Run the Gateway

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
        "content": "You are a concise technical assistant."
      },
      {
        "role": "user",
        "content": "Explain Kubernetes pods in two sentences."
      }
    ]
  }'
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8765/v1",
    api_key="local"  # Any string (required by SDK)
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
| `POST` | `/v1/chat/completions` | Standard chat completion (model: `gemini-web`, non-streaming) |
| `GET` | `/v1/models` | Lists available models (`gemini-web`) |
| `GET` | `/health` | Health status of gateway, browser, and Gemini authentication |

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
| `USE_TEMPORARY_CHAT` | `true` | Automatically enable Temporary Chat mode so requests don't pollute your Gemini sidebar history |

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
