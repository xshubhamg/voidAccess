import { Router } from "express";
import { sql } from "drizzle-orm";

import { db } from "../database/client.ts";
import { redis } from "../database/redis.ts";
import { logger } from "../utils/logger.ts";

const READINESS_TIMEOUT_MS = 2_000;

type DependencyCheck = () => Promise<unknown>;
type DependencyStatus = "up" | "down";

export interface ReadinessChecks {
  postgres: DependencyCheck;
  redis: DependencyCheck;
}

export interface ReadinessResult {
  postgres: DependencyStatus;
  redis: DependencyStatus;
}

const defaultReadinessChecks: ReadinessChecks = {
  postgres: async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
      await tx.execute(sql`SELECT 1`);
    });
  },
  redis: () => redis.ping(),
};

let defaultReadinessProbe: Promise<ReadinessResult> | null = null;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Readiness dependency check timed out")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkDependency(
  check: DependencyCheck,
  timeoutMs: number,
): Promise<DependencyStatus> {
  try {
    await withTimeout(check(), timeoutMs);
    return "up";
  } catch {
    return "down";
  }
}

async function runReadinessStatus(
  checks: ReadinessChecks,
  timeoutMs: number,
): Promise<ReadinessResult> {
  const [postgres, redisStatus] = await Promise.all([
    checkDependency(checks.postgres, timeoutMs),
    checkDependency(checks.redis, timeoutMs),
  ]);
  return { postgres, redis: redisStatus };
}

export function getReadinessStatus(
  checks: ReadinessChecks = defaultReadinessChecks,
  timeoutMs = READINESS_TIMEOUT_MS,
): Promise<ReadinessResult> {
  if (checks !== defaultReadinessChecks) {
    return runReadinessStatus(checks, timeoutMs);
  }

  if (!defaultReadinessProbe) {
    defaultReadinessProbe = runReadinessStatus(checks, timeoutMs).finally(() => {
      defaultReadinessProbe = null;
    });
  }

  return defaultReadinessProbe;
}

export function buildHealthRouter(
  readiness: () => Promise<ReadinessResult> = getReadinessStatus,
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/ready", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const dependencies = await readiness();
    const ready = dependencies.postgres === "up" && dependencies.redis === "up";

    if (!ready) {
      logger.warn({ dependencies }, "Readiness check failed");
    }

    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      dependencies,
    });
  });

  return router;
}

export const healthRouter: Router = buildHealthRouter();
