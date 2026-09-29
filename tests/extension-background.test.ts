import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

function eventTarget() {
  const listeners: any[] = [];
  return {
    listeners,
    addListener: vi.fn((listener: any) => listeners.push(listener)),
    removeListener: vi.fn((listener: any) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    }),
  };
}

async function loadBackground(initial: Record<string, any> = {}) {
  const storage = new Map(Object.entries(initial));
  const onUpdated = eventTarget();
  const tabs = new Map<number, any>([
    [7, { id: 7, url: "https://example.com/personal" }],
    [8, { id: 8, url: "https://gemini.google.com/app" }],
  ]);
  let nextTab = 20;
  let socketCreations = 0;
  class MockWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = MockWebSocket.CONNECTING;
    constructor(_url: string) {
      socketCreations++;
    }
    close() {}
    send() {}
  }
  const context: any = {
    console,
    URL,
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
    setTimeout,
    clearTimeout,
    Math,
    WebSocket: MockWebSocket,
    chrome: {
      alarms: { create: vi.fn(), onAlarm: eventTarget() },
      runtime: {
        getManifest: () => ({ version: "1.0.0" }),
        onMessage: eventTarget(),
        onStartup: eventTarget(),
      },
      storage: {
        local: {
          get: async (keys: string | string[]) => {
            const values: any = {};
            for (const key of Array.isArray(keys) ? keys : [keys]) values[key] = storage.get(key);
            return values;
          },
          set: async (values: any) => {
            for (const [key, value] of Object.entries(values)) storage.set(key, value);
          },
          remove: async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) storage.delete(key);
          },
        },
      },
      tabs: {
        get: vi.fn(async (id: number) => {
          const tab = tabs.get(id);
          if (!tab) throw new Error("missing");
          return tab;
        }),
        create: vi.fn(async (options: any) => {
          const tab = { id: nextTab++, url: options.url };
          tabs.set(tab.id, tab);
          setTimeout(() => {
            onUpdated.listeners.forEach((listener) =>
              listener(tab.id, { status: "complete" })
            );
          }, 0);
          return tab;
        }),
        remove: vi.fn(async (id: number) => { tabs.delete(id); }),
        sendMessage: vi.fn(),
        onUpdated,
        onRemoved: eventTarget(),
      },
    },
  };
  context.globalThis = context;
  context.importScripts = (file: string) => {
    vm.runInContext(fs.readFileSync(`extension/${file}`, "utf8"), context);
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("extension/background.js", "utf8"), context);
  await Promise.resolve();
  return {
    api: context.GeminiconBackgroundTest,
    protocol: context.GeminiconProtocol,
    chrome: context.chrome,
    storage,
    getSocketCreations: () => socketCreations,
  };
}

describe("extension background lifecycle", () => {
  it("does not reconnect after an explicit disconnect survives a service-worker restart", async () => {
    const state = await loadBackground({
      serverUrl: "http://127.0.0.1:8765",
      desiredConnected: false,
    });
    await Promise.resolve();
    expect(state.getSocketCreations()).toBe(0);
    expect(state.storage.get("desiredConnected")).toBe(false);
  });

  it("reuses only the dedicated managed Gemini tab", async () => {
    const existing = await loadBackground({ managedTabId: 8 });
    await expect(existing.api.ensureGeminiTab()).resolves.toBe(8);
    expect(existing.chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("recovers from a managed tab navigated away without selecting another tab", async () => {
    const state = await loadBackground({ managedTabId: 7 });
    const tabId = await state.api.ensureGeminiTab();
    expect(tabId).toBe(20);
    expect(state.chrome.tabs.create).toHaveBeenCalledWith({
      url: "https://gemini.google.com/app",
      active: false,
      pinned: true,
    });
    expect(state.storage.get("managedTabId")).toBe(20);
  });

  it("forbids query credentials and insecure non-loopback WebSockets", async () => {
    const { api } = await loadBackground();
    expect(() => api.getWebSocketUrl("https://gateway.example/ws?token=secret")).toThrow();
    expect(() => api.getWebSocketUrl("http://gateway.example")).toThrow();
    expect(api.getWebSocketUrl("http://127.0.0.1:8765")).toBe("ws://127.0.0.1:8765/ws");
    expect(api.getWebSocketUrl("https://gateway.example")).toBe("wss://gateway.example/ws");
  });

  it("uses a fresh Temporary Chat by default and preserves only an explicit repeated session", async () => {
    const { api } = await loadBackground();
    expect(api.shouldResetSession(undefined, "prior", false)).toBe(true);
    expect(api.shouldResetSession("new", "prior", false)).toBe(true);
    expect(api.shouldResetSession("same", "same", false)).toBe(false);
    expect(api.shouldResetSession("same", "same", true)).toBe(true);
  });

  it("rejects extra fields and protocol version mismatches", async () => {
    const { protocol } = await loadBackground();
    const valid = {
      type: "PING",
      protocolVersion: 1,
      nonce: "nonce-1",
    };
    expect(protocol.parseServerMessage(valid)?.type).toBe("PING");
    expect(protocol.parseServerMessage({ ...valid, credential: "secret" })).toBeNull();
    expect(protocol.parseServerMessage({ ...valid, protocolVersion: 2 })).toBeNull();
  });
});
