import Fastify, { FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { config, GatewayConfig } from "./config.js";
import { GatewayError } from "./gateway/errors.js";
import { BrowserManager } from "./providers/gemini-web/browser-manager.js";
import { GeminiWorker } from "./providers/gemini-web/gemini-worker.js";
import { TaskQueue } from "./queue/task-queue.js";
import { ExtensionHub } from "./hub/extension-hub.js";
import { registerChatCompletionsRoute } from "./api/chat-completions.js";
import { registerModelsRoute } from "./api/models.js";
import { registerHealthRoute } from "./api/health.js";

export async function createServer(
  runtimeConfig: GatewayConfig = config,
  browserManagerFactory: (value: GatewayConfig) => BrowserManager =
    (value) => new BrowserManager(value)
): Promise<{
  app: FastifyInstance;
  browserManager?: BrowserManager;
  taskQueue?: TaskQueue;
  extensionHub: ExtensionHub;
}> {
  const app = Fastify({
    logger: {
      level: runtimeConfig.logLevel,
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url?.split("?", 1)[0],
          };
        },
      },
    },
  });

  // Global Error Handler
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof GatewayError) {
      return reply.code(error.statusCode).send(error.toPayload());
    }

    const err = error as any;
    const isProduction = process.env.NODE_ENV === "production";

    // Fastify built-in schema validation or parsing error
    if (err.statusCode === 400) {
      return reply.code(400).send({
        error: {
          message: isProduction
            ? "Invalid request payload."
            : err.message || "Invalid request payload.",
          type: "invalid_request",
          code: "invalid_request",
        },
      });
    }

    if (isProduction) {
      app.log.error({ requestId: request.id }, "Unhandled request error");
    } else {
      app.log.error({ err: error, requestId: request.id }, "Unhandled request error");
    }
    const internalError = GatewayError.internalError(
      isProduction
        ? "An internal gateway error occurred."
        : err.message || "An internal gateway error occurred."
    );
    return reply.code(internalError.statusCode).send(internalError.toPayload());
  });

  // 404 Handler
  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      error: {
        message: "Endpoint not found.",
        type: "invalid_request",
        code: "endpoint_not_found",
      },
    });
  });

  // Initialize Extension Hub
  const extensionHub = new ExtensionHub(
    runtimeConfig.queueMaxSize,
    runtimeConfig.generationTimeoutMs
  );

  // Initialize Local Browser & Queue ONLY if running in 'local' mode
  let browserManager: BrowserManager | undefined;
  let taskQueue: TaskQueue | undefined;

  if (runtimeConfig.mode === "local") {
    browserManager = browserManagerFactory(runtimeConfig);
    const worker = new GeminiWorker(browserManager, runtimeConfig);
    taskQueue = new TaskQueue(
      (task) => worker.execute(task),
      runtimeConfig.queueMaxSize
    );
  }

  // Register WebSocket plugin for Extension Workers
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 2 * 1024 * 1024 + 16 * 1024 },
  });

  if (runtimeConfig.mode === "hub") {
    const wsHandler = (socket: any, request: any) => {
      if (request.url.includes("?")) {
        socket.close(1008, "Query parameters forbidden");
        return;
      }
      extensionHub.handleConnection(socket);
    };
    app.get("/ws", { websocket: true }, wsHandler);
    app.get("/hub/ws", { websocket: true }, wsHandler);
  }

  // Register API Routes
  const activeHub = runtimeConfig.mode === "hub" ? extensionHub : undefined;
  await app.register(
    registerChatCompletionsRoute(taskQueue, activeHub)
  );
  await app.register(registerModelsRoute);
  await app.register(registerHealthRoute(browserManager, activeHub));

  return { app, browserManager, taskQueue, extensionHub };
}

async function main() {
  const { app, browserManager, extensionHub } = await createServer();

  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    app.log.info(`Received ${signal}, shutting down gateway...`);
    try {
      await app.close();
      await extensionHub.close();
      if (browserManager) {
        await browserManager.close();
      }
      app.log.info("Gateway stopped cleanly.");
      process.exit(0);
    } catch (err) {
      app.log.error(err, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    // Start HTTP & WebSocket Server
    await app.listen({ host: config.host, port: config.port });

    // Initialize Browser if running in local mode
    let browserStatus = "disabled (hub mode)";
    let geminiStatus = "n/a";

    if (config.mode === "local" && browserManager) {
      browserStatus = "unavailable";
      geminiStatus = "unknown";
      try {
        await browserManager.launch();
        const health = await browserManager.checkHealth();
        browserStatus = health.browser;
        geminiStatus = health.gemini || "unknown";
      } catch (err: any) {
        app.log.warn(`Browser initialization deferred: ${err.message}`);
      }
    }

    console.log(`\n==================================`);
    console.log(`geminicon (OpenAI Gateway for Gemini Web)`);
    console.log(`==================================`);
    console.log(`Mode:       ${config.mode.toUpperCase()}`);
    const apiUrl = `http://${config.host}:${config.port}`;
    console.log(`HTTP API:   ${apiUrl}/v1/chat/completions`);
    if (config.mode === "hub") {
      const websocketUrl = apiUrl.replace(/^http/, "ws");
      console.log(`WebSocket:  ${websocketUrl}/ws`);
    }
    console.log(`Local Env:  ${browserStatus} (Gemini: ${geminiStatus})`);
    if (config.mode === "local") {
      console.log(`Headless:   ${config.headless}`);
      console.log(`Profile:    ${config.browserProfilePath}`);
    }
    console.log(`==================================\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Start if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
