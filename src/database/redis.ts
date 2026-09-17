import { Redis } from "ioredis";

import { REDIS_URL } from "../config/index.ts";
import { logger } from "../utils/logger.ts";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 2,
});

redis.on("error", (error) => {
  logger.warn({ err: error }, "Redis connection error");
});

export async function connectRedis(): Promise<void> {
  await redis.ping();
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
}
