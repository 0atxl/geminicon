import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";

describe("mode configuration & startup safety", () => {
  it("defaults local mode to loopback", () => {
    const value = loadConfig({}, "/tmp/geminicon-test");
    expect(value.mode).toBe("local");
    expect(value.host).toBe("127.0.0.1");
  });

  it("rejects public local-mode bind without GEMINICON_ALLOW_PUBLIC_LOCAL", () => {
    expect(() =>
      loadConfig({ GEMINICON_MODE: "local", HOST: "0.0.0.0" })
    ).toThrow(/Refusing to start: Local Playwright mode/);

    expect(
      loadConfig({
        GEMINICON_MODE: "local",
        HOST: "0.0.0.0",
        GEMINICON_ALLOW_PUBLIC_LOCAL: "true",
      }).host
    ).toBe("0.0.0.0");
  });

  it("rejects hub mode without GEMINICON_SERVICE_KEY", () => {
    expect(() =>
      loadConfig({ GEMINICON_MODE: "hub" })
    ).toThrow(/Hub mode requires GEMINICON_SERVICE_KEY/);
  });

  it("rejects non-loopback hub mode without HTTPS or GEMINICON_ALLOW_INSECURE_HUB", () => {
    expect(() =>
      loadConfig({
        GEMINICON_MODE: "hub",
        HOST: "0.0.0.0",
        GEMINICON_SERVICE_KEY: "service-secret-123",
      })
    ).toThrow(/Hub mode on a non-loopback host must be served behind HTTPS/);

    expect(
      loadConfig({
        GEMINICON_MODE: "hub",
        HOST: "0.0.0.0",
        GEMINICON_SERVICE_KEY: "service-secret-123",
        GEMINICON_PUBLIC_URL: "https://gateway.example",
      }).mode
    ).toBe("hub");

    expect(
      loadConfig({
        GEMINICON_MODE: "hub",
        HOST: "0.0.0.0",
        GEMINICON_SERVICE_KEY: "service-secret-123",
        GEMINICON_ALLOW_INSECURE_HUB: "true",
      }).mode
    ).toBe("hub");
  });

  it("never constructs a local browser manager in hub mode", async () => {
    const runtimeConfig = loadConfig({
      GEMINICON_MODE: "hub",
      GEMINICON_SERVICE_KEY: "service-secret-123",
    });
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
