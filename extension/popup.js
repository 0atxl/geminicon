const serverUrlInput = document.getElementById("serverUrl");
const pairingCodeInput = document.getElementById("pairingCode");
const pairBtn = document.getElementById("pairBtn");
const unpairBtn = document.getElementById("unpairBtn");

const unpairedView = document.getElementById("unpairedView");
const pairedView = document.getElementById("pairedView");
const pairedServer = document.getElementById("pairedServer");
const pairedUser = document.getElementById("pairedUser");

const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const taskCountEl = document.getElementById("taskCount");
const activeSessionInfoEl = document.getElementById("activeSessionInfo");

function updateStatusBadge(state) {
  const isConnected = state.connected === true;
  const isConnecting = state.connecting === true;

  if (isConnected) {
    statusBadge.className = "status-badge connected";
    statusText.textContent = "Connected & Ready";
  } else if (isConnecting) {
    statusBadge.className = "status-badge connecting";
    statusText.textContent = "Connecting...";
  } else {
    statusBadge.className = "status-badge";
    statusText.textContent = "Disconnected";
  }

  taskCountEl.textContent = state.taskCount || 0;
  if (state.currentSessionId) {
    activeSessionInfoEl.textContent = `Session: ${state.currentSessionId.slice(0, 10)}...`;
  } else {
    activeSessionInfoEl.textContent = "No active session";
  }
}

function renderView(data) {
  const isPaired = !!data.deviceToken;

  if (isPaired) {
    unpairedView.classList.add("hidden");
    pairedView.classList.remove("hidden");
    pairedServer.textContent = data.serverUrl || "http://127.0.0.1:8765";
    pairedUser.textContent = data.userId || "Paired User";
  } else {
    pairedView.classList.add("hidden");
    unpairedView.classList.remove("hidden");
    serverUrlInput.value = data.serverUrl || "http://127.0.0.1:8765";
  }

  updateStatusBadge(data);
}

function isLoopback(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

function validateGatewayUrl(input) {
  const url = new URL(input.includes("://") ? input : `http://${input}`);
  if (url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname))) {
    return url.origin;
  }
  throw new Error("A non-loopback gateway must use HTTPS.");
}

async function requestHostPermission(origin) {
  // Loopback origins already have permission via manifest host_permissions
  try {
    const url = new URL(origin);
    if (isLoopback(url.hostname)) return true;
  } catch { /* fall through */ }

  // Request optional_host_permission for the exact HTTPS origin
  const pattern = `${origin}/*`;
  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

// Load saved config on open
chrome.storage.local.get(
  [
    "serverUrl",
    "deviceToken",
    "userId",
    "connected",
    "connecting",
    "taskCount",
    "currentSessionId",
  ],
  (data) => {
    renderView(data);
  }
);

// Listen for updates from background service worker
chrome.storage.onChanged.addListener(() => {
  chrome.storage.local.get(
    [
      "serverUrl",
      "deviceToken",
      "userId",
      "connected",
      "connecting",
      "taskCount",
      "currentSessionId",
    ],
    (data) => {
      renderView(data);
    }
  );
});

async function getOrCreateDeviceId() {
  const data = await chrome.storage.local.get("deviceId");
  if (data.deviceId) return data.deviceId;
  const newId = "dev_" + Math.random().toString(36).substring(2, 15);
  await chrome.storage.local.set({ deviceId: newId });
  return newId;
}

// Pair Device button handler
pairBtn.addEventListener("click", async () => {
  const serverUrl = serverUrlInput.value.trim() || "http://127.0.0.1:8765";
  const code = pairingCodeInput.value.trim().toUpperCase();

  if (!code) {
    alert("Please enter a valid pairing code (e.g. PAIR-XXXX-YYYY).");
    return;
  }

  // Validate URL: reject insecure non-loopback HTTP
  let validatedOrigin;
  try {
    validatedOrigin = validateGatewayUrl(serverUrl);
  } catch (err) {
    alert(err.message);
    return;
  }

  pairBtn.disabled = true;
  pairBtn.textContent = "Pairing...";

  try {
    // Request host permission for non-loopback HTTPS gateways
    const granted = await requestHostPermission(validatedOrigin);
    if (!granted) {
      alert("Host permission is required to connect to the gateway. Please approve the permission request and try again.");
      pairBtn.disabled = false;
      pairBtn.textContent = "Pair Device";
      return;
    }

    const deviceId = await getOrCreateDeviceId();
    const endpoint = `${serverUrl.replace(/\/+$/, "")}/v1/pairing/claim`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, deviceId }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const msg = errorData.error?.message || `Pairing failed with status ${res.status}`;
      alert(msg);
      pairBtn.disabled = false;
      pairBtn.textContent = "Pair Device";
      return;
    }

    const { deviceToken, userId } = await res.json();
    await chrome.storage.local.set({
      serverUrl,
      deviceToken,
      userId,
      desiredConnected: true,
    });

    pairingCodeInput.value = "";
    chrome.runtime.sendMessage({ action: "CONNECT" });
  } catch (err) {
    alert(`Connection error: ${err.message}`);
  } finally {
    pairBtn.disabled = false;
    pairBtn.textContent = "Pair Device";
  }
});

// Unpair Device button handler — calls server-side revocation first
unpairBtn.addEventListener("click", async () => {
  unpairBtn.disabled = true;
  unpairBtn.textContent = "Unpairing...";

  try {
    const data = await chrome.storage.local.get(["serverUrl", "deviceToken"]);
    const serverUrl = data.serverUrl;
    const deviceToken = data.deviceToken;

    if (serverUrl && deviceToken) {
      const endpoint = `${serverUrl.replace(/\/+$/, "")}/v1/pairing/unpair`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${deviceToken}`,
        },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const msg = errorData.error?.message || `Unpairing failed with status ${res.status}`;
        alert(`Server-side revocation failed: ${msg}\nYour token has been kept so you can retry.`);
        unpairBtn.disabled = false;
        unpairBtn.textContent = "Unpair Device";
        return;
      }
    }

    // Server revocation succeeded (or no token to revoke) — clean up locally
    chrome.runtime.sendMessage({ action: "UNPAIR" });
    await chrome.storage.local.remove(["deviceToken", "userId"]);
    await chrome.storage.local.set({
      desiredConnected: false,
      connected: false,
      connecting: false,
    });
  } catch (err) {
    alert(`Unpair failed: ${err.message}\nYour token has been kept so you can retry.`);
  } finally {
    unpairBtn.disabled = false;
    unpairBtn.textContent = "Unpair Device";
  }
});
