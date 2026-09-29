import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";

describe("mode configuration", () => {
  it("defaults mode to hub and loopback host", () => {
    const value = loadConfig({}, "/tmp/geminicon-test");
    expect(value.mode).toBe("hub");
    expect(value.host).toBe("127.0.0.1");
    expect(value.port).toBe(8765);
  });

  it("accepts local mode", () => {
    const value = loadConfig({ GEMINICON_MODE: "local" }, "/tmp/geminicon-test");
    expect(value.mode).toBe("local");
  });

  it("never constructs a local browser manager in hub mode", async () => {
    const runtimeConfig = loadConfig({ GEMINICON_MODE: "hub" });
    const factory = vi.fn(() => {
      throw new Error("local browser accessed");
    });
    const { app, extensionHub, browserManager, taskQueue } = await createServer(
      runtimeConfig,
      factory as any
    );
    expect(factory).not.toHaveBeenCalled();
    expect(browserManager).toBeUndefined();
    expect(taskQueue).toBeUndefined();
    await app.close();
    await extensionHub.close();
  });
});
