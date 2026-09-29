import dotenv from "dotenv";
import path from "path";

dotenv.config();

export interface GatewayConfig {
  mode: "local" | "hub";
  host: string;
  port: number;
  serviceKey?: string;
  headless: boolean;
  browserProfilePath: string;
  devicesPath: string;
  generationTimeoutMs: number;
  queueMaxSize: number;
  logLevel: string;
  logContent: boolean;
  allowPublicLocal: boolean;
  allowInsecureHub: boolean;
  publicUrl?: string;
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): GatewayConfig {
  const rawMode = (env.GEMINICON_MODE || "local").toLowerCase();
  if (rawMode !== "local" && rawMode !== "hub") {
    throw new Error("GEMINICON_MODE must be either 'local' or 'hub'.");
  }
  const host = env.HOST || "127.0.0.1";
  const allowPublicLocal = env.GEMINICON_ALLOW_PUBLIC_LOCAL === "true";
  const allowInsecureHub = env.GEMINICON_ALLOW_INSECURE_HUB === "true";
  const publicUrl = env.GEMINICON_PUBLIC_URL;
  const serviceKey = env.GEMINICON_SERVICE_KEY?.trim() || undefined;

  // Startup Safety: reject unsafe public configurations
  if (rawMode === "local" && !isLoopbackHost(host) && !allowPublicLocal) {
    throw new Error(
      "Refusing to start: Local Playwright mode cannot bind to a public/non-loopback host without GEMINICON_ALLOW_PUBLIC_LOCAL=true."
    );
  }

  if (rawMode === "hub") {
    if (!serviceKey) {
      throw new Error(
        "Refusing to start: Hub mode requires GEMINICON_SERVICE_KEY to be set."
      );
    }
    if (
      !isLoopbackHost(host) &&
      (!publicUrl || !publicUrl.toLowerCase().startsWith("https://")) &&
      !allowInsecureHub
    ) {
      throw new Error(
        "Refusing to start: Hub mode on a non-loopback host must be served behind HTTPS. Set GEMINICON_PUBLIC_URL=https://... or set GEMINICON_ALLOW_INSECURE_HUB=true."
      );
    }
  }

  return {
    mode: rawMode,
    host,
    port: parseInt(env.PORT || "8765", 10),
    serviceKey,
    headless: env.HEADLESS !== "false",
    browserProfilePath:
      env.BROWSER_PROFILE_PATH || path.resolve(cwd, "browser-data/profile"),
    devicesPath:
      env.GEMINICON_DEVICES_PATH || path.resolve(cwd, ".geminicon-devices.json"),
    generationTimeoutMs: parseInt(env.GENERATION_TIMEOUT_MS || "180000", 10),
    queueMaxSize: parseInt(env.QUEUE_MAX_SIZE || "20", 10),
    logLevel: env.LOG_LEVEL || "info",
    logContent: env.LOG_CONTENT === "true",
    allowPublicLocal,
    allowInsecureHub,
    publicUrl,
  };
}

export const config: GatewayConfig = loadConfig();
