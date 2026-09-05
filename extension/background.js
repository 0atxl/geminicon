/** Geminicon Manifest V3 background worker. */
importScripts("protocol.js");

const Protocol = globalThis.GeminiconProtocol;
const ALARM_NAME = "geminicon-keepalive";
const GEMINI_URL = "https://gemini.google.com/app";
const CANCEL_CONTENT_TIMEOUT_MS = 8000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let ws = null;
let registered = false;
let reconnectTimer = null;
let reconnectAttempt = 0;
let tabCreationPromise = null;
let activeExecution = null;

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function send(type, fields) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(Protocol.message(type, fields)));
  return true;
}

function isLoopback(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

function getWebSocketUrl(serverUrl) {
  const input = serverUrl.trim();
  const url = new URL(input.includes("://") ? input : `http://${input}`);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Gateway URL must not contain credentials, query parameters, or fragments.");
  }
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:" && isLoopback(url.hostname)) url.protocol = "ws:";
  else if (url.protocol !== "wss:" && !(url.protocol === "ws:" && isLoopback(url.hostname))) {
    throw new Error("A non-loopback gateway must use HTTPS/WSS.");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
  return url.toString();
}

async function getDeviceId() {
  const stored = await chrome.storage.local.get("deviceId");
  if (stored.deviceId) return stored.deviceId;
  const deviceId = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId });
  return deviceId;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const cap = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** reconnectAttempt));
  const wait = Math.floor(cap / 2 + Math.random() * cap / 2);
  reconnectAttempt = Math.min(reconnectAttempt + 1, 10);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await connect();
  }, wait);
}

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const settings = await chrome.storage.local.get(["serverUrl", "pairingKey", "desiredConnected"]);
  if (settings.desiredConnected !== true) return;
  if (!settings.serverUrl || !settings.pairingKey) {
    await chrome.storage.local.set({ connected: false, connecting: false });
    return;
  }

  await chrome.storage.local.set({ desiredConnected: true, connected: false, connecting: true });
  let socketUrl;
  try {
    socketUrl = getWebSocketUrl(settings.serverUrl);
  } catch {
    await chrome.storage.local.set({ connected: false, connecting: false, desiredConnected: false });
    return;
  }

  try {
    ws = new WebSocket(socketUrl);
    ws.onopen = async () => {
      const deviceId = await getDeviceId();
      send("REGISTER", {
        credential: settings.pairingKey,
        deviceId,
        name: "Chrome Extension Worker",
        clientVersion: chrome.runtime.getManifest().version,
      });
    };
    ws.onmessage = async (event) => {
      let raw;
      try {
        raw = JSON.parse(event.data);
      } catch {
        ws.close(1007, "Invalid message");
        return;
      }
      const msg = Protocol.parseServerMessage(raw);
      if (!msg) {
        ws.close(1008, "Invalid message");
        return;
      }
      await handleGatewayMessage(msg);
    };
    ws.onclose = async () => {
      registered = false;
      ws = null;
      await chrome.storage.local.set({ connected: false, connecting: false });
      const state = await chrome.storage.local.get("desiredConnected");
      if (state.desiredConnected) scheduleReconnect();
    };
    ws.onerror = async () => {
      await chrome.storage.local.set({ connected: false });
    };
  } catch {
    ws = null;
    await chrome.storage.local.set({ connected: false, connecting: false });
    scheduleReconnect();
  }
}

async function disconnect() {
  await chrome.storage.local.set({ desiredConnected: false, connected: false, connecting: false });
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  registered = false;
  if (ws) ws.close(1000, "User disconnected");
  ws = null;
}

async function ensureGeminiTab() {
  if (tabCreationPromise) return tabCreationPromise;
  tabCreationPromise = (async () => {
    try {
      const stored = await chrome.storage.local.get("managedTabId");
      if (stored.managedTabId) {
        try {
          const tab = await chrome.tabs.get(stored.managedTabId);
          if (tab.url && tab.url.startsWith("https://gemini.google.com/")) return tab.id;
        } catch {}
        await chrome.storage.local.remove("managedTabId");
      }
      const tab = await chrome.tabs.create({ url: GEMINI_URL, active: false, pinned: true });
      await chrome.storage.local.set({ managedTabId: tab.id });
      await new Promise((resolve) => {
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        };
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === "complete") done();
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(done, 15000);
      });
      await delay(1000);
      return tab.id;
    } finally {
      tabCreationPromise = null;
    }
  })();
  return tabCreationPromise;
}

async function resetManagedTab() {
  const stored = await chrome.storage.local.get("managedTabId");
  if (stored.managedTabId) {
    try { await chrome.tabs.remove(stored.managedTabId); } catch {}
    await chrome.storage.local.remove("managedTabId");
  }
  tabCreationPromise = null;
  await ensureGeminiTab();
}

async function probeManagedTab() {
  let response = null;
  try {
    const tabId = await ensureGeminiTab();
    response = await chrome.tabs.sendMessage(tabId, { action: "PROBE_STATUS" });
  } catch {}
  const ready = !!response && response.pong === true && response.authenticated === true &&
    response.temporaryChatAvailable === true && Array.isArray(response.models) &&
    response.models.includes("gemini-web") && !activeExecution;
  return { response, ready };
}

async function reportDeviceStatus(probeId) {
  const { response, ready } = await probeManagedTab();
  send("DEVICE_STATUS", {
    probeId,
    status: ready ? "ready" : "connected_not_ready",
    geminiAuthenticated: !!response?.authenticated,
    contentScriptResponsive: !!response?.pong,
    temporaryChatAvailable: !!response?.temporaryChatAvailable,
    models: ready ? ["gemini-web"] : [],
  });
  if (ready && registered) {
    reconnectAttempt = 0;
    await chrome.storage.local.set({ connected: true, connecting: false });
  } else {
    await chrome.storage.local.set({ connected: false, connecting: registered });
  }
}

function shouldResetSession(sessionId, lastSessionId, resetSession) {
  return !sessionId || resetSession === true || sessionId !== lastSessionId;
}

async function executeTask(msg) {
  if (activeExecution) {
    send("TASK_ERROR", {
      taskId: msg.taskId,
      attemptId: msg.attemptId,
      errorType: "internal_error",
      message: "Managed tab is already processing a task.",
    });
    return;
  }
  const execution = { taskId: msg.taskId, attemptId: msg.attemptId, state: "active" };
  activeExecution = execution;
  await chrome.storage.local.set({ unsafeInflight: { taskId: msg.taskId, attemptId: msg.attemptId } });
  const startedAt = Date.now();
  try {
    const tabId = await ensureGeminiTab();
    const stored = await chrome.storage.local.get("lastSessionId");
    const shouldReset = shouldResetSession(
      msg.sessionId,
      stored.lastSessionId,
      msg.resetSession
    );
    const response = await chrome.tabs.sendMessage(tabId, {
      action: "EXECUTE_PROMPT",
      taskId: msg.taskId,
      attemptId: msg.attemptId,
      model: msg.model,
      prompt: msg.prompt,
      sessionId: msg.sessionId,
      resetSession: shouldReset,
      timeoutMs: msg.timeoutMs,
    });
    if (execution.state !== "active" || activeExecution !== execution) return;
    if (response?.success) {
      const count = await chrome.storage.local.get("taskCount");
      await chrome.storage.local.set({
        lastSessionId: msg.sessionId || null,
        currentSessionId: msg.sessionId || null,
        taskCount: (Number(count.taskCount) || 0) + 1,
      });
      send("TASK_COMPLETE", {
        taskId: msg.taskId,
        attemptId: msg.attemptId,
        text: response.text,
        latencyMs: Date.now() - startedAt,
      });
    } else {
      send("TASK_ERROR", {
        taskId: msg.taskId,
        attemptId: msg.attemptId,
        errorType: Protocol.ERROR_TYPES.has(response?.errorType) ? response.errorType : "upstream_error",
        message: String(response?.message || "Gemini Web task failed").slice(0, 2048),
      });
    }
  } catch {
    if (execution.state === "active" && activeExecution === execution) {
      send("TASK_ERROR", {
        taskId: msg.taskId,
        attemptId: msg.attemptId,
        errorType: "upstream_error",
        message: "Failed to communicate with the managed Gemini tab.",
      });
    }
  } finally {
    if (execution.state === "active" && activeExecution === execution) {
      activeExecution = null;
      await chrome.storage.local.remove("unsafeInflight");
    }
  }
}

async function cancelTask(msg) {
  const execution = activeExecution;
  if (!execution) {
    send("TASK_CANCELLED", {
      taskId: msg.taskId,
      attemptId: msg.attemptId,
      ready: true,
    });
    return;
  }
  if (execution.taskId !== msg.taskId || execution.attemptId !== msg.attemptId) return;
  if (execution.state === "cancelling") return;
  execution.state = "cancelling";
  let ready = false;
  try {
    const stored = await chrome.storage.local.get("managedTabId");
    if (stored.managedTabId) {
      const result = await Promise.race([
        chrome.tabs.sendMessage(stored.managedTabId, {
          action: "CANCEL_PROMPT",
          taskId: msg.taskId,
          attemptId: msg.attemptId,
        }),
        delay(CANCEL_CONTENT_TIMEOUT_MS).then(() => ({ safe: false })),
      ]);
      ready = result?.safe === true;
    }
  } catch {}
  if (!ready) {
    try {
      await resetManagedTab();
      if (activeExecution === execution) activeExecution = null;
      ready = (await probeManagedTab()).ready;
    } catch {
      ready = false;
    }
  }
  if (activeExecution === execution) activeExecution = null;
  await chrome.storage.local.remove(["unsafeInflight", "lastSessionId", "currentSessionId"]);
  send("TASK_CANCELLED", {
    taskId: msg.taskId,
    attemptId: msg.attemptId,
    ready,
  });
}

async function handleGatewayMessage(msg) {
  if (msg.type === "REGISTER_ACK") {
    if (msg.status !== "ok") {
      registered = false;
      await chrome.storage.local.set({ connected: false, connecting: false, desiredConnected: false });
      ws?.close(1008, "Registration rejected");
      return;
    }
    registered = true;
    return;
  }
  if (!registered) {
    ws?.close(1008, "Registration required");
    return;
  }
  if (msg.type === "PING") send("PONG", { nonce: msg.nonce });
  else if (msg.type === "PROBE_STATUS") await reportDeviceStatus(msg.probeId);
  else if (msg.type === "EXECUTE_TASK") await executeTask(msg);
  else if (msg.type === "CANCEL_TASK") await cancelTask(msg);
}

async function recoverUnsafeInflight() {
  const stored = await chrome.storage.local.get("unsafeInflight");
  if (!stored.unsafeInflight) return;
  try { await resetManagedTab(); } catch {}
  await chrome.storage.local.remove(["unsafeInflight", "lastSessionId", "currentSessionId"]);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const state = await chrome.storage.local.get("desiredConnected");
  if (state.desiredConnected && (!ws || (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING))) {
    await connect();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const stored = await chrome.storage.local.get("managedTabId");
  if (tabId !== stored.managedTabId) return;
  await chrome.storage.local.remove("managedTabId");
  if (activeExecution) ws?.close(1011, "Managed tab closed");
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url || changeInfo.url.startsWith("https://gemini.google.com/")) return;
  const stored = await chrome.storage.local.get("managedTabId");
  if (tabId !== stored.managedTabId) return;
  await chrome.storage.local.remove("managedTabId");
  ws?.close(1011, "Managed tab navigated away");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "CONNECT") {
    chrome.storage.local.set({ desiredConnected: true })
      .then(connect)
      .then(() => sendResponse({ status: "ok" }));
    return true;
  }
  if (message.action === "DISCONNECT") {
    disconnect().then(() => sendResponse({ status: "ok" }));
    return true;
  }
});

chrome.runtime.onStartup.addListener(() => {
  recoverUnsafeInflight().then(connect);
});
recoverUnsafeInflight().then(connect);

globalThis.GeminiconBackgroundTest = Object.freeze({
  getWebSocketUrl,
  handleGatewayMessage,
  ensureGeminiTab,
  resetManagedTab,
  shouldResetSession,
});
