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
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): GatewayConfig {
  const rawMode = (env.GEMINICON_MODE || "hub").toLowerCase();
  if (rawMode !== "local" && rawMode !== "hub") {
    throw new Error("GEMINICON_MODE must be either 'local' or 'hub'.");
  }

  const host = env.HOST || "127.0.0.1";
  const allowPublicLocal = env.GEMINICON_ALLOW_PUBLIC_LOCAL === "true";

  if (!isLoopbackHost(host) && !allowPublicLocal) {
    throw new Error(
      "Refusing to start: Minimal gateway has no authentication and cannot bind to a public/non-loopback host without GEMINICON_ALLOW_PUBLIC_LOCAL=true."
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
  };
}

export const config: GatewayConfig = loadConfig();
