import Fastify, { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { GatewayError } from "./gateway/errors.js";
import { BrowserManager } from "./providers/gemini-web/browser-manager.js";
import { GeminiWorker } from "./providers/gemini-web/gemini-worker.js";
import { TaskQueue } from "./queue/task-queue.js";
import { registerChatCompletionsRoute } from "./api/chat-completions.js";
import { registerModelsRoute } from "./api/models.js";
import { registerHealthRoute } from "./api/health.js";

export async function createServer(): Promise<{
  app: FastifyInstance;
  browserManager: BrowserManager;
  taskQueue: TaskQueue;
}> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  // Global Error Handler
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof GatewayError) {
      return reply.code(error.statusCode).send(error.toPayload());
    }

    const err = error as any;

    // Fastify built-in schema validation or parsing error
    if (err.statusCode === 400) {
      return reply.code(400).send({
        error: {
          message: err.message || "Invalid request payload.",
          type: "invalid_request",
          code: "invalid_request",
        },
      });
    }

    app.log.error(error);
    const internalError = GatewayError.internalError(
      err.message || "An unexpected error occurred."
    );
    return reply.code(internalError.statusCode).send(internalError.toPayload());
  });

  // 404 Handler
  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      error: {
        message: `Endpoint '${request.method} ${request.url}' not found.`,
        type: "invalid_request",
        code: "endpoint_not_found",
      },
    });
  });

  // Initialize Provider & Queue
  const browserManager = new BrowserManager(config);
  const worker = new GeminiWorker(browserManager, config);
  const taskQueue = new TaskQueue(
    (task) => worker.execute(task),
    config.queueMaxSize
  );

  // Register API Routes
  await app.register(registerChatCompletionsRoute(taskQueue));
  await app.register(registerModelsRoute);
  await app.register(registerHealthRoute(browserManager));

  return { app, browserManager, taskQueue };
}

async function main() {
  const { app, browserManager } = await createServer();

  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    app.log.info(`Received ${signal}, shutting down gateway...`);
    try {
      await app.close();
      await browserManager.close();
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
    // Start HTTP Server
    await app.listen({ host: config.host, port: config.port });

    // Initialize Browser
    let browserStatus = "unavailable";
    let geminiStatus = "unknown";

    try {
      await browserManager.launch();
      const health = await browserManager.checkHealth();
      browserStatus = health.browser;
      geminiStatus = health.gemini || "unknown";
    } catch (err: any) {
      app.log.warn(`Browser initialization deferred: ${err.message}`);
    }

    console.log(`\n==================================`);
    console.log(`geminicon (Minimal V1)`);
    console.log(`==================================`);
    console.log(`HTTP:     http://${config.host}:${config.port}`);
    console.log(`Browser:  ${browserStatus}`);
    console.log(`Gemini:   ${geminiStatus}`);
    console.log(`Queue:    ready (concurrency: 1)`);
    console.log(`Headless: ${config.headless}`);
    console.log(`Profile:  ${config.browserProfilePath}`);
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
