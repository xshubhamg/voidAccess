import type { Options, Store } from "express-rate-limit";

import { redis } from "../database/redis.ts";

export function createRateLimitStore(prefix: string, windowMs: number): Store {
  const keyFor = (key: string): string => `ratelimit:${prefix}:${key}`;

  return {
    localKeys: false,
    increment: async (key: string) => {
      const redisKey = keyFor(key);
      const totalHits = await redis.incr(redisKey);
      let ttl = await redis.ttl(redisKey);
      if (totalHits === 1 || ttl < 0) {
        await redis.expire(redisKey, Math.ceil(windowMs / 1000));
        ttl = Math.ceil(windowMs / 1000);
      }

      return {
        totalHits,
        resetTime: new Date(Date.now() + ttl * 1000),
      };
    },
    decrement: async (key: string) => {
      const redisKey = keyFor(key);
      const totalHits = await redis.decr(redisKey);
      if (totalHits <= 0) {
        await redis.del(redisKey);
      }
    },
    resetKey: async (key: string) => {
      await redis.del(keyFor(key));
    },
    init: (_options: Options) => undefined,
  };
}
