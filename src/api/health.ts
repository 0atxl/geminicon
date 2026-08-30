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
      let overallStatus: HealthStatus["status"] = "ok";

      if (health.browser === "unavailable") {
        overallStatus = "error";
        statusCode = 503;
      } else if (health.gemini === "authentication_required") {
        overallStatus = "degraded";
        statusCode = 503;
      }

      const response: HealthStatus = {
        status: overallStatus,
        browser: health.browser,
        ...(health.gemini ? { gemini: health.gemini } : {}),
      };

      return reply.code(statusCode).send(response);
    });
  };
};
