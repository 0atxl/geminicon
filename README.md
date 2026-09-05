# geminicon

A minimal local and multi-user gateway that wraps Google Gemini Web in a standard OpenAI-compatible Chat Completions HTTP endpoint.

Requests without an explicit session ID run inside a fresh **Temporary Chat**. Reusing the same explicit session ID is the only context-preserving path.

```text
Client / RAG / Chatbot
        │  POST /v1/chat/completions
        ▼
Fastify Gateway Hub (WebSocket Relay + Isolated Per-User FIFO Queues)
        ├── Route A: Local Playwright Chromium (Single-user standalone mode)
        └── Route B: Geminicon Chrome Extension (Multi-user team mode)
                     └── Silent background tab in team member's browser
        ▼
OpenAI-compatible JSON response
```

---

## Operating Modes

`geminicon` supports two operating modes:

1. **Standalone Local Mode**: Uses local Playwright Chromium with your own profile (`./browser-data/profile`).
2. **Hub Mode**: Accepts outbound extension WebSockets and routes sequential work to a dedicated managed Gemini tab per extension.

> **Security status:** the current shared development credential is not an authenticated device-pairing flow and is not suitable for an Internet-exposed service.

---

## Hub Development Setup (Chrome Extension)

### 1. Run the Gateway Server
```bash
npm install
npm run build
GEMINICON_MODE=hub npm start
```
Loopback development API: `http://127.0.0.1:8765`
Loopback development WebSocket: `ws://127.0.0.1:8765/ws`

A non-loopback hub should set an HTTPS public URL, for example:

```bash
GEMINICON_MODE=hub HOST=0.0.0.0 \
  GEMINICON_PUBLIC_URL=https://gateway.example.com npm start
```

The public WebSocket endpoint is `wss://gateway.example.com/ws`; terminate TLS at a trusted reverse proxy if the Node process does not terminate TLS itself.

### 2. Install Extension on Team Laptops (30 seconds)
1. Open Google Chrome $\rightarrow$ navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in top right).
3. Click **"Load unpacked"** $\rightarrow$ select the `extension/` folder from this repository.
4. Click the **Geminicon** extension icon in your Chrome toolbar:
   * **Server URL**: Your gateway address (e.g. `http://127.0.0.1:8765` or `https://gateway.myteam.internal`)
   * **Development credential**: any non-empty value works for local development; this is temporary development behavior, not public pairing.
   * Click **Connect**. The status becomes **Connected** only after registration, authentication, content-script, and Temporary Chat readiness checks succeed.

Prompts execute in silent background pinned tabs without stealing focus or interrupting the user.

---

## Standalone Local Setup (Without Extension)

### 1. One-time Login
```bash
HEADLESS=false npm start
```
Log into your Google account at `https://gemini.google.com/app`. Press `Ctrl+C` once the chat interface is visible.

### 2. Start Headless
```bash
npm start
```

---

## Usage

### Hub Development Request
Pass the same development credential in an HTTP header. Credentials in query strings are forbidden.

```bash
curl https://gateway.example.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GEMINICON_DEV_CREDENTIAL" \
  -d '{
    "model": "gemini-web",
    "messages": [
      { "role": "user", "content": "What is TCP congestion control?" }
    ]
  }'
```

### Model Selection
The API exposes only `gemini-web`; the extension does not automate Gemini's model picker.

```bash
curl https://gateway.example.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GEMINICON_DEV_CREDENTIAL" \
  -d '{
    "model": "gemini-web",
    "messages": [{ "role": "user", "content": "Write a distributed systems architecture plan." }]
  }'
```

### Multi-Turn Sessions within Temporary Chat
By default, each request starts a fresh Temporary Chat. To maintain conversational memory across turns without saving anything to your Google account sidebar, pass an `X-Session-ID`:

```bash
# Turn 1
curl https://gateway.example.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GEMINICON_DEV_CREDENTIAL" \
  -H "X-Session-ID: session_abc123" \
  -d '{
    "model": "gemini-web",
    "messages": [{ "role": "user", "content": "My favorite color is teal." }]
  }'

# Turn 2 (re-uses the existing Temporary Chat tab instantly)
curl https://gateway.example.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GEMINICON_DEV_CREDENTIAL" \
  -H "X-Session-ID: session_abc123" \
  -d '{
    "model": "gemini-web",
    "messages": [{ "role": "user", "content": "What is my favorite color?" }]
  }'
```
To force a fresh conversation, omit `X-Session-ID` or send `-H "X-Reset-Session: true"`.

---

## Endpoints

* `POST /v1/chat/completions` — OpenAI Chat Completions endpoint.
* `GET /v1/models` — Returns verified public models (currently `gemini-web`).
* `GET /health` — Distinguishes connected workers from ready workers.
* `GET /ws` — WebSocket endpoint. Registration credentials are sent only in a validated protocol message, never in the URL.

---

## Configuration (`.env`)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `GEMINICON_MODE` | `local` | Explicitly select `local` or `hub` |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8765` | Server port |
| `GEMINICON_ALLOW_PUBLIC_LOCAL` | `false` | Acknowledges the warning for a non-loopback local-mode bind |
| `GEMINICON_PUBLIC_URL` | unset | External hub URL; use HTTPS outside local development |
| `GEMINICON_ALLOW_INSECURE_HUB` | `false` | Allow an HTTP public URL only for explicit local development |
| `HEADLESS` | `true` | Set `false` for standalone browser debugging |
| `BROWSER_PROFILE_PATH` | `./browser-data/profile` | Standalone Chromium profile |
| `GENERATION_TIMEOUT_MS` | `180000` | Max wait time for response (ms) |
| `QUEUE_MAX_SIZE` | `20` | Max queue depth per user |
| `LOG_CONTENT` | `false` | Log prompt/response text in console |

Hub mode never constructs or launches Playwright and never falls back to the server operator's Google account. Local mode defaults to loopback and warns when bound publicly without an acknowledgement flag.

## Verification limitation

The automated extension harness exercises protocol validation, session isolation, cancellation, and managed-tab recovery using mocked Chrome/DOM APIs. Selector compatibility, authentication detection, Temporary Chat activation, and stop-generation behavior still require a live Chrome + Gemini Web verification pass before deployment.
