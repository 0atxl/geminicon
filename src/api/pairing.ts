import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { DeviceRegistry } from "../hub/device-registry.js";
import { ExtensionHub } from "../hub/extension-hub.js";
import { GatewayError } from "../gateway/errors.js";

const createCodeSchema = z.object({
  userId: z.string({ required_error: "Missing required field 'userId'." }).min(1, "userId must not be empty.").max(128),
});

const claimCodeSchema = z.object({
  code: z.string({ required_error: "Missing required field 'code'." }).min(1, "code must not be empty.").max(64),
  deviceId: z.string({ required_error: "Missing required field 'deviceId'." }).min(1, "deviceId must not be empty.").max(128),
});

const revokeSchema = z.object({
  userId: z.string({ required_error: "Missing required field 'userId'." }).min(1, "userId must not be empty.").max(128),
});

export const registerPairingRoutes = (
  registry: DeviceRegistry,
  serviceKey?: string,
  extensionHub?: ExtensionHub
): FastifyPluginAsync => {
  return async (fastify) => {
    const authenticateServiceKey = (authHeader?: string) => {
      if (!serviceKey) {
        throw GatewayError.internalError("Service key is not configured on this gateway.");
      }
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw GatewayError.unauthorized(
          "Missing or malformed Authorization header. Expected Bearer <service-key>."
        );
      }
      const token = authHeader.slice(7).trim();
      if (token !== serviceKey) {
        throw GatewayError.unauthorized("Invalid service key.");
      }
    };

    // 1. Create a pairing code (client backend -> Geminicon)
    fastify.post("/v1/pairing/code", async (request, reply) => {
      authenticateServiceKey(request.headers.authorization);

      const parseResult = createCodeSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw GatewayError.invalidRequest(
          parseResult.error.issues[0]?.message || "Invalid request payload."
        );
      }

      const { userId } = parseResult.data;
      const result = registry.createPairingCode(userId);
      return reply.code(200).send(result);
    });

    // 2. Claim a pairing code (Chrome Extension -> Geminicon)
    fastify.post("/v1/pairing/claim", async (request, reply) => {
      const parseResult = claimCodeSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw GatewayError.invalidRequest(
          parseResult.error.issues[0]?.message || "Invalid request payload."
        );
      }

      const { code, deviceId } = parseResult.data;
      const result = registry.claimPairingCode(code, deviceId);

      // Immediately disconnect any existing worker for this user.
      // The old token is already invalid after claimPairingCode replaced it.
      if (extensionHub) {
        extensionHub.disconnectUser(result.userId);
      }

      return reply.code(200).send(result);
    });

    // 3. Revoke via service key (client backend -> Geminicon)
    fastify.post("/v1/pairing/revoke", async (request, reply) => {
      authenticateServiceKey(request.headers.authorization);

      const parseResult = revokeSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw GatewayError.invalidRequest(
          parseResult.error.issues[0]?.message || "Invalid request payload."
        );
      }

      const { userId } = parseResult.data;
      const revoked = registry.revokeUserDevice(userId);
      if (extensionHub) {
        extensionHub.disconnectUser(userId);
      }

      return reply.code(200).send({ status: "ok", revoked });
    });

    // 4. Device-authenticated unpair (Chrome Extension -> Geminicon)
    fastify.post("/v1/pairing/unpair", async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw GatewayError.unauthorized(
          "Missing or malformed Authorization header. Expected Bearer <device-token>."
        );
      }
      const token = authHeader.slice(7).trim();
      if (!token.startsWith("gcon_dev_")) {
        throw GatewayError.unauthorized("Invalid device token.");
      }

      const userId = registry.revokeByDeviceToken(token);
      if (!userId) {
        throw GatewayError.unauthorized("Device token is not valid or already revoked.");
      }
      if (extensionHub) {
        extensionHub.disconnectUser(userId);
      }

      return reply.code(200).send({ status: "ok" });
    });
  };
};
