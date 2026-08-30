import { FastifyPluginAsync } from "fastify";
import { BrowserManager } from "../providers/gemini-web/browser-manager.js";
import { HealthStatus } from "../types.js";

export const registerHealthRoute = (
  browserManager: BrowserManager
): FastifyPluginAsync => {
  return async (fastify) => {
    fastify.get("/health", async (request, reply) => {
      const health = await browserManager.checkHealth();

      let statusCode = 200;
      let overallStatus: "ok" | "degraded" | "error" = "ok";

      if (health.browser === "unavailable") {
        overallStatus = "error";
        statusCode = 503;
      } else if (
        health.gemini === "authentication_required" ||
        health.gemini === "unavailable"
      ) {
        overallStatus = "degraded";
        statusCode = 503;
      }

      const payload: HealthStatus = {
        status: overallStatus,
        browser: health.browser,
        gemini: health.gemini,
      };

      return reply.code(statusCode).send(payload);
    });
  };
};
