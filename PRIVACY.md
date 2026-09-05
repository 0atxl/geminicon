# Privacy Policy

**Last Updated:** September 2026

This Privacy Policy explains how **geminicon** (the gateway server and Chrome extension) handles data, user interactions, and credentials.

---

### 1. Summary (Zero Telemetry, Zero Data Collection)
* **We do not collect, store, or sell any personal data.**
* **There are no third-party tracking scripts, analytics, or external telemetry services.**
* **Google credentials (passwords, tokens, cookies) are never logged, extracted, or transmitted to any external server.**

---

### 2. How Data Flows

#### A. Gateway Server
* The gateway server is deployed and managed directly by you or your organization.
* Prompts sent to `POST /v1/chat/completions` are held temporarily in memory in the in-process queue solely to transmit the request to the active worker and return the response.
* By default, prompt and response text are **never logged to disk or console** (`LOG_CONTENT=false`).

#### B. Chrome Extension
* The extension acts strictly as a local relay between your gateway server and your active browser tab on `gemini.google.com`.
* The extension only connects to the Gateway Server URL explicitly configured by the user in the extension popup.
* The extension stores your Server URL and Pairing Key locally on your device using `chrome.storage.local`. This data never leaves your device except to authenticate against your own designated server.

---

### 3. Google Account & Credential Security
* **No Access to Passwords**: The extension does not capture, read, or transmit your Google password or two-factor authentication codes.
* **No Cookie Extraction**: The extension does not read or export raw session cookies (`SID`, `HSID`, `__Secure-3PSID`) across the network. It interacts solely with the page's standard DOM inside your existing browser session.
* **Temporary Chat Mode**: The software is designed to execute queries inside Google Gemini's **Temporary Chat** mode. Google does not save Temporary Chats to your recent chats history, and they are discarded per Google's safety data retention policies.

---

### 4. Third-Party Services
When prompts are processed by Gemini Web, your interactions are transmitted to Google LLC and governed by:
* [Google Privacy Policy](https://policies.google.com/privacy)
* [Gemini Apps Privacy Notice](https://support.google.com/gemini/answer/13594961)

---

### 5. Open Source Auditability
Because this project is 100% open source, you and your organization are encouraged to inspect the full source code in this repository to verify all data handling, networking, and privacy claims.
