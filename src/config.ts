import dotenv from "dotenv";
import path from "path";

dotenv.config();

export interface GatewayConfig {
  mode: "local" | "hub";
  host: string;
  port: number;
  headless: boolean;
  browserProfilePath: string;
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

  if (rawMode === "local" && !isLoopbackHost(host) && !allowPublicLocal) {
    console.warn(
      "[geminicon] Local mode is binding beyond loopback. Set GEMINICON_ALLOW_PUBLIC_LOCAL=true to acknowledge this configuration."
    );
  }
  if (rawMode === "hub" && !isLoopbackHost(host) &&
      (!publicUrl || !publicUrl.toLowerCase().startsWith("https://"))) {
    console.warn(
      "[geminicon] Non-loopback hub mode should be published behind HTTPS; set GEMINICON_PUBLIC_URL to the external URL."
    );
  }
  if (
    rawMode === "hub" &&
    publicUrl &&
    !publicUrl.toLowerCase().startsWith("https://") &&
    !allowInsecureHub
  ) {
    console.warn(
      "[geminicon] Hub public URL is not HTTPS. Use this only for local development or set GEMINICON_ALLOW_INSECURE_HUB=true to acknowledge it."
    );
  }

  return {
    mode: rawMode,
    host,
    port: parseInt(env.PORT || "8765", 10),
    headless: env.HEADLESS !== "false",
    browserProfilePath:
      env.BROWSER_PROFILE_PATH || path.resolve(cwd, "browser-data/profile"),
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
