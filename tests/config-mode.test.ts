import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";

describe("mode configuration", () => {
  it("defaults local mode to loopback", () => {
    const value = loadConfig({}, "/tmp/geminicon-test");
    expect(value.mode).toBe("local");
    expect(value.host).toBe("127.0.0.1");
  });

  it("warns but permits a public local-mode bind without the acknowledgement flag", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadConfig({ GEMINICON_MODE: "local", HOST: "0.0.0.0" }).host).toBe(
      "0.0.0.0"
    );
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("beyond loopback"));
    expect(loadConfig({
      GEMINICON_MODE: "local",
      HOST: "0.0.0.0",
      GEMINICON_ALLOW_PUBLIC_LOCAL: "true",
    }).host).toBe("0.0.0.0");
    warning.mockRestore();
  });

  it("warns but permits a non-loopback hub without a declared HTTPS URL", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadConfig({ GEMINICON_MODE: "hub", HOST: "0.0.0.0" }).mode).toBe(
      "hub"
    );
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("behind HTTPS"));
    expect(loadConfig({
      GEMINICON_MODE: "hub",
      HOST: "0.0.0.0",
      GEMINICON_PUBLIC_URL: "https://gateway.example",
    }).mode).toBe("hub");
    warning.mockRestore();
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
