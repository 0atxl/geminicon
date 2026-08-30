# Gemini Web Gateway — Minimal V1 Implementation Plan

## 1. Goal

Build a minimal local gateway:

```text
Your RAG / Chatbot
        │
        ▼
POST /v1/chat/completions
        │
        ▼
Gemini Web Gateway
        │
        ▼
Playwright Browser Worker
        │
        ▼
gemini.google.com
        │
        ▼
Gemini generates response
        │
        ▼
Gateway extracts answer
        │
        ▼
OpenAI-compatible JSON
        │
        ▼
Your Application
```

The gateway should behave like a small OpenAI-compatible server.

Your application should be able to use:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8765/v1",
    api_key="local"
)

response = client.chat.completions.create(
    model="gemini-web",
    messages=[
        {
            "role": "user",
            "content": "Explain Kubernetes pods."
        }
    ]
)

print(response.choices[0].message.content)
```

`api_key="local"` is only there because the OpenAI SDK expects a value.

It is NOT a Gemini API key.

---

# 2. V1 Scope

Implement only:

```text
POST /v1/chat/completions
GET  /health
GET  /v1/models
```

Nothing else.

Remove:

```text
/v1/embeddings
/v1/responses
/dashboard
/playground
/settings
/traffic
/provider routing
/api-key fallback
/local synthetic fallback
/mock responses
worker simulator
Gemini SDK
@google/genai
```

The only provider in V1 is:

```text
gemini-web
```

---

# 3. Core Architecture

```text
                      ┌──────────────────────┐
                      │   RAG / Chatbot      │
                      └──────────┬───────────┘
                                 │
                                 │ HTTP
                                 ▼
                      ┌──────────────────────┐
                      │    HTTP Gateway      │
                      │   Fastify/Express    │
                      └──────────┬───────────┘
                                 │
                                 ▼
                      ┌──────────────────────┐
                      │ Request Normalizer   │
                      └──────────┬───────────┘
                                 │
                                 ▼
                      ┌──────────────────────┐
                      │    Task Queue        │
                      │ concurrency = 1      │
                      └──────────┬───────────┘
                                 │
                                 ▼
                      ┌──────────────────────┐
                      │ Gemini Web Worker    │
                      └──────────┬───────────┘
                                 │
                                 ▼
                      ┌──────────────────────┐
                      │ Playwright Chromium  │
                      │ persistent profile   │
                      └──────────┬───────────┘
                                 │
                                 ▼
                         gemini.google.com
                                 │
                                 ▼
                         generated answer
                                 │
                                 ▼
                      ┌──────────────────────┐
                      │ Response Extractor   │
                      └──────────┬───────────┘
                                 │
                                 ▼
                      ┌──────────────────────┐
                      │ Response Normalizer  │
                      └──────────┬───────────┘
                                 │
                                 ▼
                       OpenAI-compatible JSON
```

---

# 4. Request Flow

## Step 1 — Application sends request

Example:

```http
POST /v1/chat/completions
Content-Type: application/json
```

Payload:

```json
{
  "model": "gemini-web",
  "messages": [
    {
      "role": "system",
      "content": "Answer based on the provided context."
    },
    {
      "role": "user",
      "content": "Context: ...\n\nQuestion: Explain feature X."
    }
  ]
}
```

---

# 5. Request Validation

Validate only what V1 supports.

Required:

```text
model
messages
```

Supported roles:

```text
system
user
assistant
```

For V1:

```text
stream = false
```

If:

```json
{
  "stream": true
}
```

return:

```json
{
  "error": {
    "message": "Streaming is not supported in V1.",
    "type": "unsupported_feature"
  }
}
```

Do not silently behave differently.

---

# 6. Prompt Normalization

Gemini Web expects one interaction, while OpenAI requests may contain multiple messages.

Convert:

```json
[
  {
    "role": "system",
    "content": "You are a helpful assistant."
  },
  {
    "role": "user",
    "content": "What is TCP?"
  }
]
```

into something like:

```text
SYSTEM INSTRUCTIONS

You are a helpful assistant.

USER

What is TCP?
```

For conversation-style inputs:

```text
SYSTEM:
...

USER:
...

ASSISTANT:
...

USER:
...
```

Everything should be passed to Gemini as a single final prompt in V1.

This also solves the bug in the previous prototype where the system instruction could be separated and never reach the browser worker.

---

# 7. Internal Request Object

After validation, convert the OpenAI request into a simple internal structure.

```ts
interface GatewayTask {
    id: string;
    model: "gemini-web";
    prompt: string;
    createdAt: number;
}
```

Example:

```json
{
  "id": "req_01JXYZ",
  "model": "gemini-web",
  "prompt": "SYSTEM INSTRUCTIONS\n...\n\nUSER\n...",
  "createdAt": 1788100000000
}
```

Do not pass OpenAI-specific objects throughout the whole application.

Normalize early.

---

# 8. Task Queue

Use one worker initially.

```text
Request A
Request B
Request C
    │
    ▼
┌────────────┐
│ FIFO Queue │
└─────┬──────┘
      │
      ▼
Browser Worker
```

Concurrency:

```text
1
```

Reasons:

- avoids two prompts entering the same page
- avoids response mixing
- easier debugging
- easier completion detection
- less Gemini Web load
- fewer browser race conditions

---

# 9. Browser Manager

The Browser Manager should create and maintain exactly one Chromium instance.

Responsibilities:

```text
start browser
check browser
restart browser after crash
provide page to worker
shutdown cleanly
```

Use Playwright.

Conceptually:

```ts
chromium.launchPersistentContext(
    PROFILE_PATH,
    {
        headless: true
    }
)
```

Use a persistent profile:

```text
~/.local/share/gemini-web-gateway/profile/
```

The user logs into Gemini normally once using this dedicated browser profile.

The gateway itself should NOT contain:

```text
Google password
Gemini API key
manually extracted cookies
manually extracted tokens
```

The browser manages its normal authenticated state.

---

# 10. First-Time Authentication

For initial setup, allow:

```text
headless = false
```

Start Chromium.

The user logs into:

```text
https://gemini.google.com/
```

Close the browser.

The persistent profile remains.

Then production operation can run:

```text
headless = true
```

If login expires, return:

```json
{
  "error": {
    "type": "authentication_required",
    "message": "Gemini Web authentication is required."
  }
}
```

Do not attempt to automatically bypass login challenges.

---

# 11. Gemini Worker

The worker gets:

```ts
GatewayTask
```

It performs:

```text
receive task
    ↓
ensure browser exists
    ↓
ensure Gemini page available
    ↓
start fresh chat
    ↓
find prompt input
    ↓
insert complete normalized prompt
    ↓
submit
    ↓
wait for Gemini response
    ↓
detect generation completion
    ↓
extract response text
    ↓
return WorkerResult
```

---

# 12. Fresh Chat Per Request

Each API request should be independent.

```text
Request A
    ↓
Fresh Gemini chat
    ↓
Response
    ↓
Done


Request B
    ↓
Fresh Gemini chat
    ↓
Response
    ↓
Done
```

Do not maintain conversation state in Gemini.

The calling application is responsible for sending previous messages if conversation history is needed.

For example:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "My name is Alex."
    },
    {
      "role": "assistant",
      "content": "Hello Alex."
    },
    {
      "role": "user",
      "content": "What is my name?"
    }
  ]
}
```

The gateway serializes all of that into the fresh Gemini request.

---

# 13. Gemini Page Adapter

All Gemini-specific DOM logic should live in ONE place.

Do not scatter selectors across the project.

Example:

```text
providers/
    gemini-web/
        selectors.ts
```

Conceptually:

```ts
export const selectors = {
    promptInput: "...",
    sendButton: "...",
    responseContainer: "...",
    stopGeneratingButton: "..."
};
```

If Gemini changes its webpage later, only this layer needs modification.

---

# 14. Prompt Submission

Do not emulate typing character-by-character unless necessary.

Prefer:

```text
locate composer
    ↓
focus
    ↓
insert entire prompt
    ↓
verify inserted text
    ↓
submit
```

Before submitting, verify:

```text
actual composer content == intended prompt
```

If not:

```json
{
  "error": {
    "type": "prompt_submission_failed"
  }
}
```

---

# 15. Response Completion Detection

Do NOT rely only on:

```text
response unchanged for 2 seconds
```

because Gemini may pause during generation.

Use multiple signals.

Possible logic:

```text
response exists
      +
generation indicator disappeared
      +
send/submit state returned
      +
response text remained stable
```

Only then mark complete.

Conceptually:

```ts
while (!timeout) {
    const text = await readResponse();
    const generating = await isGenerating();

    if (!generating && text && text === previousText) {
        stableCount++;

        if (stableCount >= REQUIRED_STABILITY) {
            return text;
        }
    } else {
        stableCount = 0;
    }

    previousText = text;
}
```

Use a meaningful stability interval such as a few seconds.

---

# 16. Generation Timeout

Example:

```text
180 seconds
```

Configuration:

```env
GENERATION_TIMEOUT_MS=180000
```

If exceeded:

```json
{
  "error": {
    "type": "generation_timeout",
    "message": "Gemini did not complete generation within the configured timeout."
  }
}
```

Do not generate a fake fallback response.

---

# 17. Worker Result

The browser worker should return:

```ts
interface WorkerResult {
    requestId: string;
    text: string;
    latencyMs: number;
}
```

Example:

```json
{
  "requestId": "req_01JXYZ",
  "text": "TCP congestion control...",
  "latencyMs": 8274
}
```

---

# 18. OpenAI Response Normalization

Convert that result into OpenAI Chat Completions format.

Example response:

```json
{
  "id": "chatcmpl-req_01JXYZ",
  "object": "chat.completion",
  "created": 1788100000,
  "model": "gemini-web",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "TCP congestion control..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

Yes — returning **OpenAI-compatible JSON** is the right choice.

It allows existing software to connect with almost no changes.

---

# 19. Usage Field

Because Gemini Web does not provide reliable API token accounting to the gateway, do NOT invent usage values.

Two reasonable options:

### Option A

Return:

```json
"usage": {
  "prompt_tokens": 0,
  "completion_tokens": 0,
  "total_tokens": 0
}
```

### Option B

Omit:

```text
usage
```

entirely.

I prefer **omitting it** initially rather than pretending zero tokens were used.

---

# 20. Models Endpoint

Implement:

```text
GET /v1/models
```

Response:

```json
{
  "object": "list",
  "data": [
    {
      "id": "gemini-web",
      "object": "model",
      "owned_by": "local"
    }
  ]
}
```

Do not scrape available Gemini models in V1.

There is only:

```text
gemini-web
```

from the gateway's perspective.

---

# 21. Health Endpoint

```text
GET /health
```

Example healthy response:

```json
{
  "status": "ok",
  "browser": "ready",
  "gemini": "ready"
}
```

Authentication expired:

```json
{
  "status": "degraded",
  "browser": "ready",
  "gemini": "authentication_required"
}
```

Browser crashed:

```json
{
  "status": "error",
  "browser": "unavailable"
}
```

---

# 22. Error Format

Use one error format everywhere.

Example:

```json
{
  "error": {
    "message": "Gemini Web generation timed out.",
    "type": "generation_timeout",
    "code": "gemini_generation_timeout"
  }
}
```

Possible errors:

```text
invalid_request
unsupported_model
unsupported_feature
browser_unavailable
authentication_required
prompt_submission_failed
generation_timeout
response_extraction_failed
upstream_limit
upstream_error
internal_error
```

---

# 23. No Fallbacks

This is critical.

The flow must be:

```text
Gemini succeeds
      ↓
return Gemini answer
```

or:

```text
Gemini fails
      ↓
return error
```

Never:

```text
Gemini fails
      ↓
generate local fake response
      ↓
200 OK
```

And never:

```text
Gemini fails
      ↓
try Gemini API key
```

V1 has ONE provider.

---

# 24. No Gemini SDK

Remove:

```text
@google/genai
```

Remove environment variables such as:

```text
GEMINI_API_KEY
GOOGLE_API_KEY
```

The project should not know that an official Gemini API even exists.

---

# 25. Minimal Project Structure

Recommended:

```text
gemini-web-gateway/
│
├── src/
│   │
│   ├── server.ts
│   │
│   ├── config.ts
│   │
│   ├── types.ts
│   │
│   ├── api/
│   │   ├── chat-completions.ts
│   │   ├── models.ts
│   │   └── health.ts
│   │
│   ├── gateway/
│   │   ├── request-normalizer.ts
│   │   ├── response-normalizer.ts
│   │   └── errors.ts
│   │
│   ├── queue/
│   │   └── task-queue.ts
│   │
│   └── providers/
│       └── gemini-web/
│           ├── browser-manager.ts
│           ├── gemini-worker.ts
│           ├── gemini-page.ts
│           ├── selectors.ts
│           └── types.ts
│
├── tests/
│   ├── request-normalizer.test.ts
│   ├── response-normalizer.test.ts
│   └── queue.test.ts
│
├── browser-data/
│   └── .gitkeep
│
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

# 26. Responsibility of Each File

## `server.ts`

Application startup.

```text
load config
start HTTP server
start BrowserManager
register routes
handle shutdown
```

---

## `config.ts`

Only configuration.

Example:

```ts
export const config = {
    host: "127.0.0.1",
    port: 8765,
    generationTimeoutMs: 180000,
    browserProfilePath: "./browser-data/profile",
    headless: true
};
```

---

## `types.ts`

Shared types.

```ts
OpenAIChatRequest
NormalizedRequest
NormalizedResponse
GatewayError
```

---

## `api/chat-completions.ts`

Implements:

```text
POST /v1/chat/completions
```

Flow:

```text
validate
normalize
enqueue
await result
normalize response
send JSON
```

---

## `api/models.ts`

Implements:

```text
GET /v1/models
```

---

## `api/health.ts`

Implements:

```text
GET /health
```

---

## `gateway/request-normalizer.ts`

Converts:

```text
OpenAI messages
```

into:

```text
one Gemini prompt
```

---

## `gateway/response-normalizer.ts`

Converts:

```text
Gemini output
```

into:

```text
OpenAI ChatCompletion JSON
```

---

## `gateway/errors.ts`

Defines standardized errors.

---

## `queue/task-queue.ts`

Simple FIFO queue.

Concurrency:

```text
1
```

---

## `browser-manager.ts`

Owns:

```text
Chromium
persistent context
Gemini page
browser recovery
```

---

## `gemini-worker.ts`

Executes:

```text
task
 ↓
Gemini
 ↓
result
```

---

## `gemini-page.ts`

High-level operations:

```ts
openGemini()
ensureAuthenticated()
startFreshChat()
submitPrompt()
waitForCompletion()
extractResponse()
```

The worker should call these methods rather than containing DOM code itself.

---

## `selectors.ts`

Only Gemini DOM selectors.

This becomes the main maintenance point if Gemini changes its UI.

---

# 27. Dependencies

Minimal package dependencies:

```text
fastify
playwright
zod
pino
```

Development:

```text
typescript
tsx
vitest
@types/node
```

No React.

No Vite frontend.

No Gemini SDK.

No database.

No Redis.

No Docker requirement initially.

---

# 28. `.env.example`

Keep it tiny.

```env
HOST=127.0.0.1
PORT=8765

HEADLESS=true
BROWSER_PROFILE_PATH=./browser-data/profile

GENERATION_TIMEOUT_MS=180000
QUEUE_MAX_SIZE=20
```

No:

```text
GEMINI_API_KEY
```

---

# 29. `.gitignore`

```gitignore
node_modules/
dist/

.env

browser-data/profile/
browser-data/**/*.json

*.log
```

The browser profile must never be committed.

---

# 30. Startup Flow

```text
npm start
    ↓
load config
    ↓
start Fastify
    ↓
start Playwright persistent browser
    ↓
open Gemini
    ↓
verify authenticated state
    ↓
gateway ready
```

Terminal:

```text
Gemini Web Gateway
------------------
HTTP:     http://127.0.0.1:8765
Browser:  ready
Gemini:   authenticated
Queue:    ready
```

---

# 31. Actual Request Lifecycle

Complete lifecycle:

```text
RAG
 │
 │ POST /v1/chat/completions
 ▼
HTTP Route
 │
 ▼
Zod validation
 │
 ▼
Request Normalizer
 │
 │
 │ system + history + query
 │        ↓
 │    single prompt
 ▼
Task Queue
 │
 ▼
Gemini Worker
 │
 ▼
Browser Manager
 │
 ▼
Gemini Page
 │
 ├── fresh chat
 ├── insert prompt
 ├── submit
 ├── wait
 └── extract response
 │
 ▼
WorkerResult
 │
 ▼
Response Normalizer
 │
 ▼
OpenAI JSON
 │
 ▼
RAG
```

---

# 32. Example RAG Request

Suppose your RAG retrieves:

```text
Document A
Document B
Document C
```

Your application sends:

```json
{
  "model": "gemini-web",
  "messages": [
    {
      "role": "system",
      "content": "Answer only using the supplied documents."
    },
    {
      "role": "user",
      "content": "DOCUMENTS:\n...\n\nQUESTION:\nHow does authentication work?"
    }
  ]
}
```

Gateway creates:

```text
SYSTEM INSTRUCTIONS

Answer only using the supplied documents.


USER

DOCUMENTS:

Document A
...

Document B
...

Document C
...


QUESTION

How does authentication work?
```

That goes to Gemini.

Gemini returns:

```text
Authentication works by...
```

Gateway returns:

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1788100000,
  "model": "gemini-web",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Authentication works by..."
      },
      "finish_reason": "stop"
    }
  ]
}
```

That is all the RAG system needs.

---

# 33. First Milestone

Do NOT integrate RAG immediately.

First make this work:

```bash
curl http://127.0.0.1:8765/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-web",
    "messages": [
      {
        "role": "user",
        "content": "Reply exactly with: gateway works"
      }
    ]
  }'
```

Expected:

```json
{
  "id": "...",
  "object": "chat.completion",
  "model": "gemini-web",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "gateway works"
      },
      "finish_reason": "stop"
    }
  ]
}
```

Until this works reliably, add nothing else.

---

# 34. Second Milestone

Test system instructions:

```text
system:
Reply only with JSON.

user:
What is 2 + 2?
```

Verify Gemini receives both.

This specifically validates the bug that existed in the previous prototype.

---

# 35. Third Milestone

Test sequential requests:

```text
Request A
Request B
Request C
```

Verify:

```text
A completes
then B
then C
```

No mixed answers.

---

# 36. Fourth Milestone

Connect OpenAI SDK:

```python
client = OpenAI(
    base_url="http://127.0.0.1:8765/v1",
    api_key="local"
)
```

If that works without modifications to the SDK, the compatibility layer is successful.

---

# 37. Fifth Milestone

Connect one real RAG project.

Change only:

```text
base_url
model
```

From:

```text
Groq / OpenAI endpoint
```

to:

```text
http://127.0.0.1:8765/v1
```

The RAG pipeline itself should remain unchanged.

---

# 38. V1 Definition of Done

V1 is complete when:

```text
✓ no Gemini API key
✓ no Google GenAI SDK
✓ no fallback
✓ no fake response
✓ no frontend
✓ no dashboard
✓ no embeddings endpoint
✓ no persistent Gemini conversation
✓ one browser worker
✓ one queue
✓ fresh chat per inference
✓ OpenAI-compatible request
✓ OpenAI-compatible response
✓ explicit errors
✓ localhost only
✓ works with OpenAI Python/JS SDK
✓ works with one real RAG application
```

At that point stop adding features.

That is the minimal useful project.