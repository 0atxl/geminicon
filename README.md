# geminicon

A minimal local and multi-user gateway that wraps Google Gemini Web in a standard OpenAI-compatible Chat Completions HTTP endpoint.

Requests without an explicit session ID run inside a fresh **Temporary Chat**. Reusing the same explicit session ID is the only context-preserving path.

```text
Client Backend
        │  POST /v1/chat/completions
        │  Authorization: Bearer <service-key>
        │  X-Geminicon-User-ID: <userId>
        ▼
Fastify Gateway Hub (WebSocket Relay + Isolated Per-User FIFO Queues)
        ├── Route A: Local Playwright Chromium (Single-user standalone mode)
        └── Route B: Geminicon Chrome Extension (Multi-user hub mode)
                     └── Silent background tab in team member's browser
        ▼
OpenAI-compatible JSON response
```

---

## Operating Modes

`geminicon` supports two operating modes:

1. **Standalone Local Mode**: Uses local Playwright Chromium with your own profile (`./browser-data/profile`).
2. **Hub Mode**: Accepts outbound extension WebSockets and routes sequential work to a dedicated managed Gemini tab per extension.

---

## Hub Setup (Chrome Extension)

### 1. Run the Gateway Server
```bash
npm install
npm run build
GEMINICON_MODE=hub GEMINICON_SERVICE_KEY=your-secret npm start
```
`GEMINICON_SERVICE_KEY` is **required** in hub mode. The service key authenticates client backend requests for creating/revoking pairings and authorizing generation.

Loopback development API: `http://127.0.0.1:8765`
Loopback development WebSocket: `ws://127.0.0.1:8765/ws`

A non-loopback hub must set an HTTPS public URL (or the startup safety check will refuse to start):

```bash
GEMINICON_MODE=hub HOST=0.0.0.0 \
  GEMINICON_SERVICE_KEY=your-secret \
  GEMINICON_PUBLIC_URL=https://gateway.example.com npm start
```

The public WebSocket endpoint is `wss://gateway.example.com/ws`; terminate TLS at a trusted reverse proxy if the Node process does not terminate TLS itself.

### 2. Pair a Chrome Extension (30 seconds)

**Create a pairing code** from your client backend:
```bash
curl -X POST http://127.0.0.1:8765/v1/pairing/code \
  -H "Authorization: Bearer $GEMINICON_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_alice"}'
```
This returns a single-use pairing code that expires after **10 minutes**.

**Install the extension:**
1. Open Google Chrome → navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in top right).
3. Click **"Load unpacked"** → select the `extension/` folder from this repository.
4. Click the **Geminicon** extension icon in your Chrome toolbar:
   * **Server URL**: Your gateway address (e.g. `http://127.0.0.1:8765` or `https://gateway.example.com`)
   * **Pairing Code**: The code from step above.
   * Click **Pair Device**. The status becomes **Connected & Ready** after registration, authentication, and readiness checks succeed.

The extension receives a persistent **device token** that authenticates only its WebSocket registration. Device tokens cannot call `/v1/chat/completions`.

### 3. Unpairing

Click **Unpair Device** in the extension popup. This calls the gateway to revoke the server-side token before clearing local storage. If server revocation fails, the token is retained so you can retry.

The client backend can also revoke a device:
```bash
curl -X POST http://127.0.0.1:8765/v1/pairing/revoke \
  -H "Authorization: Bearer $GEMINICON_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_alice"}'
```

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

### Hub Mode Request
The client backend authenticates with the service key and identifies the target user:

```bash
curl https://gateway.example.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GEMINICON_SERVICE_KEY" \
  -H "X-Geminicon-User-ID: user_alice" \
  -d '{
    "model": "gemini-web",
    "messages": [
      { "role": "user", "content": "What is TCP congestion control?" }
    ]
  }'
```

`X-Geminicon-User-ID` is an opaque user identifier used for routing. Generation requires the service key; device tokens are rejected.

### Multi-Turn Sessions within Temporary Chat
By default, each request starts a fresh Temporary Chat. To maintain conversational memory across turns without saving anything to your Google account sidebar, pass an `X-Session-ID`:

```bash
# Turn 1
curl https://gateway.example.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GEMINICON_SERVICE_KEY" \
  -H "X-Geminicon-User-ID: user_alice" \
  -H "X-Session-ID: session_abc123" \
  -d '{
    "model": "gemini-web",
    "messages": [{ "role": "user", "content": "My favorite color is teal." }]
  }'

# Turn 2 (re-uses the existing Temporary Chat tab instantly)
curl https://gateway.example.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GEMINICON_SERVICE_KEY" \
  -H "X-Geminicon-User-ID: user_alice" \
  -H "X-Session-ID: session_abc123" \
  -d '{
    "model": "gemini-web",
    "messages": [{ "role": "user", "content": "What is my favorite color?" }]
  }'
```
To force a fresh conversation, omit `X-Session-ID` or send `-H "X-Reset-Session: true"`.

---

## Endpoints

* `POST /v1/chat/completions` — OpenAI Chat Completions endpoint. Requires `Authorization: Bearer <service-key>` and `X-Geminicon-User-ID` in hub mode.
* `POST /v1/pairing/code` — Create a pairing code (service-key authenticated).
* `POST /v1/pairing/claim` — Claim a pairing code (unauthenticated, single-use, expires in 10 min).
* `POST /v1/pairing/revoke` — Revoke a device (service-key authenticated).
* `POST /v1/pairing/unpair` — Device self-revocation (device-token authenticated).
* `GET /v1/models` — Returns verified public models (currently `gemini-web`).
* `GET /health` — Distinguishes connected workers from ready workers.
* `GET /ws` — WebSocket endpoint. Device tokens are sent only in a validated protocol message, never in the URL.

---

## Configuration (`.env`)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `GEMINICON_MODE` | `local` | Explicitly select `local` or `hub` |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8765` | Server port |
| `GEMINICON_SERVICE_KEY` | *(required in hub)* | Authenticates client backend callers |
| `GEMINICON_ALLOW_PUBLIC_LOCAL` | `false` | Required to bind local mode beyond loopback |
| `GEMINICON_PUBLIC_URL` | unset | External hub URL; use HTTPS outside local development |
| `GEMINICON_ALLOW_INSECURE_HUB` | `false` | Allow an HTTP public URL only for explicit local development |
| `GEMINICON_DEVICES_PATH` | `.geminicon-devices.json` | Path to the device registry JSON file |
| `HEADLESS` | `true` | Set `false` for standalone browser debugging |
| `BROWSER_PROFILE_PATH` | `./browser-data/profile` | Standalone Chromium profile |
| `GENERATION_TIMEOUT_MS` | `180000` | Max wait time for response (ms) |
| `QUEUE_MAX_SIZE` | `20` | Max queue depth per user |
| `LOG_CONTENT` | `false` | Log prompt/response text in console |

Hub mode never constructs or launches Playwright and never falls back to the server operator's Google account. Local mode defaults to loopback. Unsafe public configurations fail startup.

## Verification limitation

The automated extension harness exercises protocol validation, session isolation, cancellation, and managed-tab recovery using mocked Chrome/DOM APIs. Selector compatibility, authentication detection, Temporary Chat activation, and stop-generation behavior still require a live Chrome + Gemini Web verification pass before deployment.
