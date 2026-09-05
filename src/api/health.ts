import { FastifyPluginAsync } from "fastify";
import { BrowserManager } from "../providers/gemini-web/browser-manager.js";
import { ExtensionHub } from "../hub/extension-hub.js";
import { HealthStatus } from "../types.js";

export const registerHealthRoute = (
  browserManager?: BrowserManager,
  extensionHub?: ExtensionHub
): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get("/health", async (_request, reply) => {
      const connectedWorkers = extensionHub?.getConnectedWorkerCount() || 0;
      const readyWorkers = extensionHub?.getReadyWorkerCount() || 0;

      if (!browserManager) {
        const isOk = readyWorkers > 0;
        const payload: HealthStatus = {
          status: isOk ? "ok" : "degraded",
          browser: isOk ? "ready" : "unavailable",
          gemini: isOk ? "ready" : "unavailable",
          connectedWorkers,
          readyWorkers,
        };
        return reply.code(isOk ? 200 : 503).send(payload);
      }

      const health = await browserManager.checkHealth();
      let statusCode = 200;
      let overallStatus: "ok" | "degraded" | "error" = "ok";

      if (health.browser === "unavailable") {
        overallStatus = readyWorkers > 0 ? "ok" : "error";
        statusCode = readyWorkers > 0 ? 200 : 503;
      } else if (
        health.gemini === "authentication_required" ||
        health.gemini === "unavailable"
      ) {
        overallStatus = readyWorkers > 0 ? "ok" : "degraded";
        statusCode = readyWorkers > 0 ? 200 : 503;
      }

      const payload: HealthStatus = {
        status: overallStatus,
        browser: health.browser,
        gemini: health.gemini,
        connectedWorkers,
        readyWorkers,
      };

      return reply.code(statusCode).send(payload);
    });
  };
};
