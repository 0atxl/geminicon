# geminicon

A minimal local gateway that wraps your authenticated Google Gemini Web session in a standard OpenAI-compatible Chat Completions HTTP endpoint.

Every request runs inside a fresh **Temporary Chat** on Gemini Web—meaning zero chats saved to your account history and zero state leak between requests.

```text
Client / RAG / Chatbot
        │  POST /v1/chat/completions
        ▼
Fastify Gateway (FIFO Queue, concurrency = 1)
        │
        ▼
Playwright Chromium (Persistent Google Profile)
        │
        ▼
gemini.google.com/app (Temporary Chat)
        │
        ▼
OpenAI-compatible JSON response
```

---

## Quickstart

### 1. Install
```bash
npm install
npx playwright install chromium
```

### 2. First-time Login (One-Time)
Run the browser with a visible window to log into your Google Account:

```bash
HEADLESS=false npm start
```

Log into Gemini at `https://gemini.google.com/app`. Once the chat UI is visible, press `Ctrl+C` to stop. Your session cookies and tokens are stored in `./browser-data/profile`.

### 3. Run in Background
```bash
npm start
```

Default address: `http://127.0.0.1:8765`

---

## Usage

### cURL
```bash
curl http://127.0.0.1:8765/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-web",
    "messages": [
      { "role": "system", "content": "Answer concisely." },
      { "role": "user", "content": "What is TCP congestion control?" }
    ]
  }'
```

### Python (OpenAI SDK)
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8765/v1",
    api_key="local"  # Dummy key, required by SDK
)

response = client.chat.completions.create(
    model="gemini-web",
    messages=[
        {"role": "user", "content": "Explain Kubernetes pods in two sentences."}
    ]
)

print(response.choices[0].message.content)
```

---

## Endpoints

* `POST /v1/chat/completions` — OpenAI Chat Completions endpoint (`model: "gemini-web"`, text only, non-streaming).
* `GET /v1/models` — Returns `{ "object": "list", "data": [{ "id": "gemini-web" }] }`.
* `GET /health` — Returns `{ "status": "ok", "browser": "ready", "gemini": "ready" }`.

---

## Configuration (`.env`)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8765` | Server port |
| `HEADLESS` | `true` | Set `false` to see browser interactions |
| `BROWSER_PROFILE_PATH` | `./browser-data/profile` | Chromium profile directory |
| `GENERATION_TIMEOUT_MS` | `180000` | Max wait time for response (ms) |
| `QUEUE_MAX_SIZE` | `20` | Max queued requests before returning 429 |
| `LOG_CONTENT` | `false` | Set `true` to log prompt/response text in console |

---

## Limitations

* **Sequential execution (`concurrency: 1`)**: Single browser context processes one request at a time.
* **DOM dependent**: Selector adjustments in `src/providers/gemini-web/selectors.ts` may be needed if Google updates the Gemini web UI.
* **No streaming / tools in V1**: Text completions only.
