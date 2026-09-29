import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import path from "path";
import os from "os";
import fs from "fs";
import { DeviceRegistry } from "../src/hub/device-registry.js";
import { registerPairingRoutes } from "../src/api/pairing.js";
import { registerChatCompletionsRoute } from "../src/api/chat-completions.js";
import { ExtensionHub } from "../src/hub/extension-hub.js";
import { GatewayError } from "../src/gateway/errors.js";
import {
  GEMINICON_PROTOCOL_VERSION,
  WSClientMessage,
} from "../src/types.js";

const SERVICE_KEY = "test-service-key-secret-999";

function makeTmpPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geminicon-test-"));
  return path.join(dir, "devices.json");
}

function clientMessage<T extends Omit<WSClientMessage, "protocolVersion">>(
  value: T
): T & { protocolVersion: 1 } {
  return { ...value, protocolVersion: GEMINICON_PROTOCOL_VERSION };
}

function mockSocket() {
  const handlers = new Map<string, (...args: any[]) => void>();
  const sent: any[] = [];
  const ws: any = {
    readyState: 1,
    send: vi.fn((raw: string) => sent.push(JSON.parse(raw))),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
    }),
  };
  return {
    ws,
    sent,
    receive(message: WSClientMessage | Record<string, unknown> | string) {
      handlers.get("message")?.(
        typeof message === "string" ? message : JSON.stringify(message)
      );
    },
    close() {
      handlers.get("close")?.();
    },
  };
}

function registerReady(hub: ExtensionHub, token: string, socket = mockSocket()) {
  hub.handleConnection(socket.ws);
  socket.receive(clientMessage({
    type: "REGISTER",
    deviceToken: token,
    deviceId: "device-1",
    clientVersion: "1.0.0",
  }));
  const probe = socket.sent.find((m) => m.type === "PROBE_STATUS");
  if (probe) {
    socket.receive(clientMessage({
      type: "DEVICE_STATUS",
      probeId: probe.probeId,
      status: "ready",
      geminiAuthenticated: true,
      contentScriptResponsive: true,
      temporaryChatAvailable: true,
      models: ["gemini-web"],
    }));
  }
  return socket;
}

describe("Pairing & Device Authentication Protocol", () => {
  let tmpPath: string;
  let registry: DeviceRegistry;
  let hub: ExtensionHub;
  let app: FastifyInstance;

  beforeEach(async () => {
    tmpPath = makeTmpPath();
    registry = new DeviceRegistry(tmpPath);
    hub = new ExtensionHub(10, 5000, 5000, registry);

    app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof GatewayError) {
        return reply.code(error.statusCode).send(error.toPayload());
      }
      return reply.code(500).send({ error: { message: (error as any).message } });
    });

    await app.register(registerPairingRoutes(registry, SERVICE_KEY, hub));
    await app.register(registerChatCompletionsRoute(undefined, hub, SERVICE_KEY));
  });

  afterEach(async () => {
    await app.close();
    await hub.close();
    try {
      const dir = path.dirname(tmpPath);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  it("requires a valid service key to create a pairing code", async () => {
    // Missing auth header
    const resNoAuth = await app.inject({
      method: "POST",
      url: "/v1/pairing/code",
      payload: { userId: "user_alice" },
    });
    expect(resNoAuth.statusCode).toBe(401);

    // Wrong service key
    const resWrongAuth = await app.inject({
      method: "POST",
      url: "/v1/pairing/code",
      headers: { authorization: "Bearer wrong-key" },
      payload: { userId: "user_alice" },
    });
    expect(resWrongAuth.statusCode).toBe(401);

    // Valid service key
    const resOk = await app.inject({
      method: "POST",
      url: "/v1/pairing/code",
      headers: { authorization: `Bearer ${SERVICE_KEY}` },
      payload: { userId: "user_alice" },
    });
    expect(resOk.statusCode).toBe(200);
    const body = JSON.parse(resOk.body);
    expect(body.code).toMatch(/^PAIR-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.expiresAt).toBeDefined();
  });

  it("claims pairing code once and generates a persistent 256-bit device token", async () => {
    const codeRes = await app.inject({
      method: "POST",
      url: "/v1/pairing/code",
      headers: { authorization: `Bearer ${SERVICE_KEY}` },
      payload: { userId: "user_bob" },
    });
    const { code } = JSON.parse(codeRes.body);

    // Claim successfully
    const claimRes = await app.inject({
      method: "POST",
      url: "/v1/pairing/claim",
      payload: { code, deviceId: "chrome_dev_1" },
    });
    expect(claimRes.statusCode).toBe(200);
    const claimBody = JSON.parse(claimRes.body);
    expect(claimBody.userId).toBe("user_bob");
    expect(claimBody.deviceToken).toMatch(/^gcon_dev_[a-f0-9]{64}$/); // 256-bit hex token

    // Single use: claiming the same code again fails
    const claimAgainRes = await app.inject({
      method: "POST",
      url: "/v1/pairing/claim",
      payload: { code, deviceId: "chrome_dev_2" },
    });
    expect(claimAgainRes.statusCode).toBe(400);
  });

  it("rejects expired pairing codes", async () => {
    // Create code with 1ms TTL
    const { code } = registry.createPairingCode("user_fast_expire", 1);
    await new Promise((r) => setTimeout(r, 10));

    const claimRes = await app.inject({
      method: "POST",
      url: "/v1/pairing/claim",
      payload: { code, deviceId: "chrome_dev_expired" },
    });
    expect(claimRes.statusCode).toBe(400);
    const body = JSON.parse(claimRes.body);
    expect(body.error.message).toContain("expired");
  });

  it("validates device token against registry and rejects invalid or unregistered tokens", () => {
    expect(registry.validateDeviceToken("invalid_random_string").valid).toBe(false);
    expect(registry.validateDeviceToken("gcon_dev_0000000000000000000000000000000000000000000000000000000000000000").valid).toBe(false);

    const { code } = registry.createPairingCode("user_charlie");
    const { deviceToken } = registry.claimPairingCode(code, "dev_charlie_1");

    const validated = registry.validateDeviceToken(deviceToken);
    expect(validated.valid).toBe(true);
    expect(validated.userId).toBe("user_charlie");
    expect(validated.deviceId).toBe("dev_charlie_1");
  });

  it("replaces previous device when a new device pairs for the same user", async () => {
    // Device 1 pairs
    const code1 = registry.createPairingCode("user_multi_device").code;
    const token1 = registry.claimPairingCode(code1, "laptop_1").deviceToken;
    expect(registry.validateDeviceToken(token1).valid).toBe(true);

    // Device 2 pairs for same user -> replaces device 1
    const code2 = registry.createPairingCode("user_multi_device").code;
    const token2 = registry.claimPairingCode(code2, "laptop_2").deviceToken;

    expect(registry.validateDeviceToken(token2).valid).toBe(true);
    expect(registry.validateDeviceToken(token2).deviceId).toBe("laptop_2");

    // Old token is no longer valid
    expect(registry.validateDeviceToken(token1).valid).toBe(false);
  });

  it("revokes user device via service key", async () => {
    const { code } = registry.createPairingCode("user_to_revoke");
    const { deviceToken } = registry.claimPairingCode(code, "dev_rev");
    expect(registry.validateDeviceToken(deviceToken).valid).toBe(true);

    // Revoke via API
    const revokeRes = await app.inject({
      method: "POST",
      url: "/v1/pairing/revoke",
      headers: { authorization: `Bearer ${SERVICE_KEY}` },
      payload: { userId: "user_to_revoke" },
    });
    expect(revokeRes.statusCode).toBe(200);
    expect(JSON.parse(revokeRes.body).revoked).toBe(true);

    // Device token is now invalid
    expect(registry.validateDeviceToken(deviceToken).valid).toBe(false);
  });

  it("rejects device tokens from calling /v1/chat/completions", async () => {
    const { code } = registry.createPairingCode("user_attacker");
    const { deviceToken } = registry.claimPairingCode(code, "dev_attacker");

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${deviceToken}`,
      },
      payload: {
        model: "gemini-web",
        messages: [{ role: "user", content: "attempt" }],
      },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.message).toContain("Device tokens cannot authorize generation API calls");
  });

  it("routes /v1/chat/completions to the target user via service key and X-Geminicon-User-ID", async () => {
    // Pair a device for user 'user_alice'
    const { code } = registry.createPairingCode("user_alice");
    const { deviceToken } = registry.claimPairingCode(code, "alice_laptop");

    // Mock an active worker in the hub for user_alice
    const mockWorker = {
      ws: { readyState: 1, send: vi.fn(), close: vi.fn() },
      key: "user_alice",
      deviceId: "alice_laptop",
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      state: "ready",
      geminiAuthenticated: true,
      temporaryChatAvailable: true,
      models: ["gemini-web"],
    };
    (hub as any).workers.set("user_alice", mockWorker);

    // Call chat completions with service key and X-Geminicon-User-ID
    const userQueue = hub.getUserQueue("user_alice");
    const enqueueSpy = vi.spyOn(userQueue, "enqueue").mockResolvedValueOnce({
      requestId: "req_test",
      text: '{"data": "sample response"}',
      latencyMs: 150,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${SERVICE_KEY}`,
        "x-geminicon-user-id": "user_alice",
      },
      payload: {
        model: "gemini-web",
        messages: [{ role: "user", content: "Generate content" }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const responseBody = JSON.parse(res.body);
    expect(responseBody.choices[0].message.content).toBe('{"data": "sample response"}');
  });

  // --- Persistence tests ---

  it("survives reconstruction from disk: device token remains valid after reload", () => {
    const { code } = registry.createPairingCode("user_persist");
    const { deviceToken } = registry.claimPairingCode(code, "persist_dev");
    expect(registry.validateDeviceToken(deviceToken).valid).toBe(true);

    // Construct a second registry from the saved file
    const registry2 = new DeviceRegistry(tmpPath);
    const validation = registry2.validateDeviceToken(deviceToken);
    expect(validation.valid).toBe(true);
    expect(validation.userId).toBe("user_persist");
    expect(validation.deviceId).toBe("persist_dev");
  });

  it("surfaces persistence failure when the registry cannot write", () => {
    // Point registry at a read-only path
    const readonlyPath = path.join(os.tmpdir(), "geminicon-readonly-" + Date.now(), "subdir", "devices.json");
    const readonlyDir = path.dirname(path.dirname(readonlyPath));
    fs.mkdirSync(readonlyDir, { recursive: true });
    // Create the file first, then make the directory read-only
    fs.writeFileSync(path.join(readonlyDir, "placeholder"), "");
    const reg = new DeviceRegistry(readonlyPath);

    // Make the subdir creation fail by creating a file at the expected dir path
    const subdir = path.dirname(readonlyPath);
    fs.writeFileSync(subdir, "blocker");

    expect(() => reg.createPairingCode("user_fail")).toThrow();

    // Clean up
    try {
      fs.unlinkSync(subdir);
      fs.rmSync(readonlyDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  it("throws on corrupt registry file at startup", () => {
    const corruptPath = makeTmpPath();
    fs.writeFileSync(corruptPath, "NOT VALID JSON {{{{", "utf-8");

    expect(() => new DeviceRegistry(corruptPath)).toThrow(/Corrupt device registry/);

    // Clean up
    try { fs.rmSync(path.dirname(corruptPath), { recursive: true, force: true }); } catch {}
  });

  // --- Unpair endpoint tests ---

  it("revokes device token via device-authenticated /v1/pairing/unpair", async () => {
    const { code } = registry.createPairingCode("user_self_unpair");
    const { deviceToken } = registry.claimPairingCode(code, "self_dev");
    expect(registry.validateDeviceToken(deviceToken).valid).toBe(true);

    const res = await app.inject({
      method: "POST",
      url: "/v1/pairing/unpair",
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe("ok");

    // Token is now invalid
    expect(registry.validateDeviceToken(deviceToken).valid).toBe(false);
  });

  it("rejects /v1/pairing/unpair with invalid token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/pairing/unpair",
      headers: { authorization: "Bearer gcon_dev_0000000000000000000000000000000000000000000000000000000000000000" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects /v1/pairing/unpair without authorization", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/pairing/unpair",
    });
    expect(res.statusCode).toBe(401);
  });

  // --- Replacement disconnect test (Fix 3) ---

  it("immediately disconnects the old worker when a new device pairs for the same user", async () => {
    // Pair user, register a websocket worker
    const code1 = registry.createPairingCode("user_replace").code;
    const { deviceToken: token1 } = registry.claimPairingCode(code1, "old_device");
    const socket1 = registerReady(hub, token1);

    expect(hub.hasWorker("user_replace")).toBe(true);

    // Now pair a new device for the same user (via the API, which calls disconnectUser)
    const code2Res = await app.inject({
      method: "POST",
      url: "/v1/pairing/code",
      headers: { authorization: `Bearer ${SERVICE_KEY}` },
      payload: { userId: "user_replace" },
    });
    const { code: code2 } = JSON.parse(code2Res.body);

    const claimRes = await app.inject({
      method: "POST",
      url: "/v1/pairing/claim",
      payload: { code: code2, deviceId: "new_device" },
    });
    expect(claimRes.statusCode).toBe(200);

    // Old token is invalid
    expect(registry.validateDeviceToken(token1).valid).toBe(false);

    // Old websocket was closed
    expect(socket1.ws.close).toHaveBeenCalledWith(1008, "Device pairing revoked");

    // Old worker is no longer in the hub
    expect(hub.hasWorker("user_replace")).toBe(false);
  });
});
