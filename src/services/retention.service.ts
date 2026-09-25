import { sql } from "drizzle-orm";

import {
  RETENTION_AUDIT_DAYS,
  RETENTION_CLEANUP_INTERVAL,
  RETENTION_TERMINAL_DAYS,
} from "../config/index.ts";
import type { Database } from "../database/client.ts";
import { logger } from "../utils/logger.ts";
import { parseDurationMs } from "../utils/tokens.ts";

const CLEANUP_BATCH_SIZE = 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = parseDurationMs(RETENTION_CLEANUP_INTERVAL);

export interface RetentionCleanupSummary {
  sessions: number;
  verificationTokens: number;
  invites: number;
  emailDeliveries: number;
  auditLogs: number;
}

function rowsDeleted(result: { rowCount?: number | null }): number {
  return result.rowCount ?? 0;
}

export async function runRetentionCleanup(
  db: Database,
  now = new Date(),
): Promise<RetentionCleanupSummary> {
  const terminalCutoff = new Date(now.getTime() - RETENTION_TERMINAL_DAYS * 24 * 60 * 60 * 1000);
  const auditCutoff = new Date(now.getTime() - RETENTION_AUDIT_DAYS * 24 * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      WITH expired AS (
        SELECT "id" FROM "sessions"
        WHERE "status" = 'active' AND "expires_at" <= ${now}
        ORDER BY "expires_at"
        LIMIT ${CLEANUP_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "sessions"
      SET "status" = 'expired', "status_changed_at" = ${now}
      WHERE "id" IN (SELECT "id" FROM "expired")
    `);

    const sessions = rowsDeleted(
      await tx.execute(sql`
        DELETE FROM "sessions"
        WHERE "legal_hold_at" IS NULL
          AND "status" IN ('revoked', 'expired')
          AND "status_changed_at" <= ${terminalCutoff}
          AND "id" IN (
          SELECT "id" FROM "sessions"
          WHERE "legal_hold_at" IS NULL
            AND "status" IN ('revoked', 'expired')
            AND "status_changed_at" <= ${terminalCutoff}
          LIMIT ${CLEANUP_BATCH_SIZE}
        )
      `),
    );
    const verificationTokens = rowsDeleted(
      await tx.execute(sql`
        DELETE FROM "email_verification_tokens"
        WHERE "legal_hold_at" IS NULL
          AND "expires_at" <= ${terminalCutoff}
          AND "id" IN (
          SELECT "id" FROM "email_verification_tokens"
          WHERE "legal_hold_at" IS NULL AND "expires_at" <= ${terminalCutoff}
          LIMIT ${CLEANUP_BATCH_SIZE}
        )
      `),
    );
    const invites = rowsDeleted(
      await tx.execute(sql`
        DELETE FROM "invites"
        WHERE "legal_hold_at" IS NULL
          AND (
            ("status" <> 'pending' AND "status_changed_at" <= ${terminalCutoff})
            OR ("status" = 'pending' AND "expires_at" <= ${terminalCutoff})
          )
          AND "id" IN (
          SELECT "id" FROM "invites"
          WHERE "legal_hold_at" IS NULL
            AND (
              ("status" <> 'pending' AND "status_changed_at" <= ${terminalCutoff})
              OR ("status" = 'pending' AND "expires_at" <= ${terminalCutoff})
            )
          LIMIT ${CLEANUP_BATCH_SIZE}
        )
      `),
    );
    const emailDeliveries = rowsDeleted(
      await tx.execute(sql`
        DELETE FROM "email_deliveries"
        WHERE "legal_hold_at" IS NULL
          AND "status" IN ('sent', 'failed')
          AND "terminal_at" <= ${terminalCutoff}
          AND "id" IN (
          SELECT "id" FROM "email_deliveries"
          WHERE "legal_hold_at" IS NULL
            AND "status" IN ('sent', 'failed')
            AND "terminal_at" <= ${terminalCutoff}
          LIMIT ${CLEANUP_BATCH_SIZE}
        )
      `),
    );
    const auditLogs = rowsDeleted(
      await tx.execute(sql`
        DELETE FROM "audit_logs"
        WHERE "legal_hold_at" IS NULL
          AND "created_at" <= ${auditCutoff}
          AND "id" IN (
          SELECT "id" FROM "audit_logs"
          WHERE "legal_hold_at" IS NULL AND "created_at" <= ${auditCutoff}
          LIMIT ${CLEANUP_BATCH_SIZE}
        )
      `),
    );

    return { sessions, verificationTokens, invites, emailDeliveries, auditLogs };
  });
}

export function startRetentionCleanupWorker(
  db: Database,
  intervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
): () => Promise<void> {
  let stopped = false;
  let running = false;
  let activeRun: Promise<void> = Promise.resolve();

  const run = (): void => {
    if (stopped || running) return;
    running = true;
    activeRun = (async () => {
      try {
        const summary = await runRetentionCleanup(db);
        if (Object.values(summary).some((count) => count > 0)) {
          logger.info(summary, "Retention cleanup completed");
        }
      } catch (error) {
        logger.error({ err: error }, "Retention cleanup failed");
      } finally {
        running = false;
      }
    })();
    void activeRun;
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();

  return async () => {
    stopped = true;
    clearInterval(timer);
    await activeRun;
  };
}
