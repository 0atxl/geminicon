import { FastifyPluginAsync } from "fastify";
import { ModelsResponse } from "../types.js";

export const registerModelsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get("/v1/models", async (_request, reply) => {
    const response: ModelsResponse = {
      object: "list",
      data: [
        {
          id: "gemini-web",
          object: "model",
          owned_by: "local",
        },
      ],
    };

    return reply.code(200).send(response);
  });
};
