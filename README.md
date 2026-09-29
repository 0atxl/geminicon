# Geminicon

A minimal local proxy that wraps **Google Gemini Web** into an **OpenAI-compatible HTTP API** (`/v1/chat/completions`).

No API keys, no billing, no credit card required—prompts run inside a silent, background Temporary Chat in your browser.

---

## ⚡ Quickstart (1 Minute)

### 1. Install & Build
```bash
npm install
npm run build
npm start
```
The gateway is now running at `http://127.0.0.1:8765`.

### 2. Connect Your Chrome Extension
1. Open Google Chrome $\rightarrow$ go to `chrome://extensions/`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** $\rightarrow$ select the `extension/` folder in this repo.
4. Click the **Geminicon** extension icon in your toolbar $\rightarrow$ click **Connect**.
5. When it turns green (**Connected & Ready**), you're all set!

---

## 🚀 Usage

Use standard OpenAI client libraries or `curl`. No API keys or extra headers required on localhost.

### `curl`
```bash
curl http://127.0.0.1:8765/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-web",
    "messages": [
      { "role": "user", "content": "Explain quantum computing in one sentence." }
    ]
  }'
```

### Python (`openai` package)
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8765/v1",
    api_key="none"  # Any dummy string works
)

response = client.chat.completions.create(
    model="gemini-web",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)
```

### TypeScript / Node.js (`openai` package)
```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:8765/v1",
  apiKey: "none",
});

const completion = await client.chat.completions.create({
  model: "gemini-web",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(completion.choices[0].message.content);
```

---

## 💬 Multi-Turn Sessions

By default, every prompt runs in a fresh, isolated Temporary Chat. To maintain conversational memory across turns (and speed up generation by 3–5 seconds), send an `X-Session-ID` header:

```bash
# Turn 1
curl http://127.0.0.1:8765/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: session_123" \
  -d '{"model": "gemini-web", "messages": [{"role": "user", "content": "My favorite fruit is mango."}]}'

# Turn 2 (instant context reuse)
curl http://127.0.0.1:8765/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: session_123" \
  -d '{"model": "gemini-web", "messages": [{"role": "user", "content": "What is my favorite fruit?"}]}'
```

---

## ⚙️ Configuration (`.env`)

Optional settings (defaults work out of the box for personal use):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `GEMINICON_MODE` | `hub` | `hub` (Chrome Extension relay, recommended) or `local` (Playwright headless Chromium). |
| `HOST` | `127.0.0.1` | Server bind host. |
| `PORT` | `8765` | Server port. |
| `GENERATION_TIMEOUT_MS` | `180000` | Max wait time for response (ms). |
| `QUEUE_MAX_SIZE` | `20` | Max queue depth. |

---

## 📖 Detailed Documentation

* [Architecture & Operating Modes](docs/ARCHITECTURE.md)
* [Full API Reference & Error Codes](docs/API.md)

---

## 📄 License

MIT.
