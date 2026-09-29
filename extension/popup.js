const serverUrlInput = document.getElementById("serverUrl");
const toggleBtn = document.getElementById("toggleBtn");
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const taskCountEl = document.getElementById("taskCount");
const activeSessionInfoEl = document.getElementById("activeSessionInfo");

function updateUI(state) {
  const isConnected = state.connected === true;
  const isConnecting = state.connecting === true;

  if (isConnected) {
    statusBadge.className = "status-badge connected";
    statusText.textContent = "Connected & Ready";
    toggleBtn.textContent = "Disconnect";
    toggleBtn.className = "disconnect";
  } else if (isConnecting) {
    statusBadge.className = "status-badge connecting";
    statusText.textContent = "Connecting...";
    toggleBtn.textContent = "Cancel";
    toggleBtn.className = "disconnect";
  } else {
    statusBadge.className = "status-badge";
    statusText.textContent = "Disconnected";
    toggleBtn.textContent = "Connect";
    toggleBtn.className = "";
  }

  taskCountEl.textContent = state.taskCount || 0;
  if (state.currentSessionId) {
    activeSessionInfoEl.textContent = `Session: ${state.currentSessionId.slice(0, 10)}...`;
  } else {
    activeSessionInfoEl.textContent = "No active session";
  }
}

// Load saved config on open
chrome.storage.local.get(
  ["serverUrl", "connected", "connecting", "taskCount", "currentSessionId"],
  (data) => {
    serverUrlInput.value = data.serverUrl || "http://127.0.0.1:8765";
    updateUI(data);
  }
);

// Listen for updates from background service worker
chrome.storage.onChanged.addListener(() => {
  chrome.storage.local.get(
    ["connected", "connecting", "taskCount", "currentSessionId"],
    (data) => {
      updateUI(data);
    }
  );
});

// Toggle Connect / Disconnect button handler
toggleBtn.addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["connected", "connecting"]);
  const isBusy = data.connected === true || data.connecting === true;

  if (isBusy) {
    chrome.runtime.sendMessage({ action: "DISCONNECT" });
    await chrome.storage.local.set({
      desiredConnected: false,
      connected: false,
      connecting: false,
    });
  } else {
    const serverUrl = serverUrlInput.value.trim() || "http://127.0.0.1:8765";
    await chrome.storage.local.set({
      serverUrl,
      desiredConnected: true,
      connecting: true,
    });
    chrome.runtime.sendMessage({ action: "CONNECT" });
  }
});
