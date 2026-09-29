# Geminicon

A minimal local proxy that wraps **Google Gemini Web** into an **OpenAI-compatible HTTP API** (`/v1/chat/completions`).

No API keys, no billing, no credit card required—prompts run inside a silent, background Temporary Chat in your browser.

---

## ⚡ Quickstart

### Option A: With Chrome Extension (Recommended & Easiest)
> Uses your existing Chrome browser where you are already signed into your Google account. Zero CAPTCHAs, zero login walls.

1. **Start the Gateway:**
   ```bash
   npm install
   npm run build
   npm start
   ```
   *(Running at `http://127.0.0.1:8765`)*

2. **Connect the Chrome Extension:**
   - Open Chrome $\to$ go to `chrome://extensions/`.
   - Enable **Developer mode** (top-right toggle).
   - Click **Load unpacked** $\to$ select the `extension/` folder in this repo.
   - Click the **Geminicon** icon in your Chrome toolbar $\to$ click **Connect**.
   - When the badge turns green (**Connected & Ready**), you're all set!

---

### Option B: Without Extension (Standalone Playwright Chromium)
> Runs an automated browser in the background. Good for headless servers or when you don't want Chrome open.

1. **First-Time Google Sign-in:**
   In `.env`, set:
   ```ini
   GEMINICON_MODE=local
   HEADLESS=false
   ```
2. **Start Gateway and Sign In Once:**
   ```bash
   npm start
   ```
   A browser window will open. Sign into your Google account at [gemini.google.com](https://gemini.google.com/). Once logged in, stop the server (`Ctrl+C`). Your session is saved in `./browser-data/profile`.

3. **Run Headless:**
   Set `HEADLESS=true` in `.env` and run `npm start`. All requests will route through the headless browser without needing Chrome or the extension.

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

## ❓ Troubleshooting

| Error | Cause | Fix |
| :--- | :--- | :--- |
| `worker_not_connected` | Gateway is in `hub` mode but extension is not connected yet. | Open extension popup and click **Connect** (badge turns green), or switch to `GEMINICON_MODE=local`. |
| `authentication_required` | Google Gemini session expired. | Open [gemini.google.com](https://gemini.google.com/) in Chrome (hub mode) or run with `HEADLESS=false` (local mode) and sign in. |
| `temporary_chat_unavailable` | Extension could not find Temporary Chat. | Ensure you are on desktop view and not on a Google Workspace account with temporary chat disabled. |

---

## 👥 Multi-User & Team Deployments

Need a shared server where team members pair their own devices using single-use pairing codes and Service Key authentication? Switch to the **`team-hub`** branch:
```bash
git checkout team-hub
```

---

## 📄 License

MIT.
