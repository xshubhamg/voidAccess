import { buildApp } from "./app.ts";
import { NODE_ENV, PORT, RESEND_API_KEY, EMAIL_FROM } from "./config/index.ts";
import { closeDatabase, connectDatabase, db } from "./database/client.ts";
import { closeRedis, connectRedis } from "./database/redis.ts";
import { startEmailDeliveryWorker } from "./services/email-delivery.service.ts";
import { sendResendEmail } from "./services/resend-email.service.ts";
import { startRetentionCleanupWorker } from "./services/retention.service.ts";
import { logger } from "./utils/logger.ts";

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  await connectDatabase();
  logger.info("Database connection verified");

  try {
    await connectRedis();
    logger.info("Redis connection verified");
  } catch (error) {
    logger.warn(
      { err: error },
      "Redis unavailable — permission cache disabled, falling back to database",
    );
  }

  let stopEmailDeliveryWorker: (() => void) | undefined;
  if (RESEND_API_KEY && EMAIL_FROM) {
    stopEmailDeliveryWorker = startEmailDeliveryWorker(db, sendResendEmail);
    logger.info("Email delivery worker started");
  } else {
    logger.warn("Email delivery worker disabled — configure RESEND_API_KEY and EMAIL_FROM");
  }

  const stopRetentionCleanupWorker = startRetentionCleanupWorker(db);
  logger.info("Retention cleanup worker started");

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
      try {
        await Promise.allSettled([stopEmailDeliveryWorker?.(), stopRetentionCleanupWorker()]);
        try {
          await closeDatabase();
        } catch (error) {
          logger.error({ err: error }, "Failed to close database pool");
        }
        try {
          await closeRedis();
        } catch (error) {
          logger.error({ err: error }, "Failed to close Redis connection");
        }
      } finally {
        clearTimeout(forceExitTimer);
        process.exit(0);
      }
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
