import dotenv from "dotenv";
import path from "path";

dotenv.config();

export interface GatewayConfig {
  host: string;
  port: number;
  headless: boolean;
  browserProfilePath: string;
  generationTimeoutMs: number;
  queueMaxSize: number;
  logLevel: string;
  logContent: boolean;
}

export const config: GatewayConfig = {
  host: process.env.HOST || "127.0.0.1",
  port: parseInt(process.env.PORT || "8765", 10),
  headless: process.env.HEADLESS !== "false",
  browserProfilePath:
    process.env.BROWSER_PROFILE_PATH ||
    path.resolve(process.cwd(), "browser-data/profile"),
  generationTimeoutMs: parseInt(
    process.env.GENERATION_TIMEOUT_MS || "180000",
    10
  ),
  queueMaxSize: parseInt(process.env.QUEUE_MAX_SIZE || "20", 10),
  logLevel: process.env.LOG_LEVEL || "info",
  logContent: process.env.LOG_CONTENT === "true",
};
