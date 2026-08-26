import { buildApp } from "./app.ts";
import { NODE_ENV, PORT } from "./config/index.ts";
import { closeDatabase, connectDatabase } from "./database/client.ts";
import { logger } from "./utils/logger.ts";

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  await connectDatabase();
  logger.info("Database connection verified");

  const server = buildApp().listen(PORT, () => {
    logger.info({ port: PORT, env: NODE_ENV }, "Server started");
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Shutdown initiated");

    const forceExitTimer = setTimeout(() => {
      logger.error("Graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    server.close(async () => {
      clearTimeout(forceExitTimer);
      try {
        await closeDatabase();
      } catch (error) {
        logger.error({ err: error }, "Failed to close database pool");
      }
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled rejection");
    shutdown("unhandledRejection");
  });
}

main().catch((error) => {
  logger.error({ err: error }, "Failed to start server");
  process.exit(1);
});
