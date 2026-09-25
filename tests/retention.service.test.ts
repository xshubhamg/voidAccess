import { describe, expect, it } from "bun:test";

import type { Database } from "../src/database/client.ts";
import { runRetentionCleanup } from "../src/services/retention.service.ts";

function fakeDatabase() {
  const statements: string[] = [];
  const db = {
    transaction: async (
      callback: (tx: {
        execute: (query: unknown) => Promise<{ rowCount: number }>;
      }) => Promise<unknown>,
    ) => {
      return callback({
        execute: async (query: unknown) => {
          statements.push(JSON.stringify(query));
          return { rowCount: 1 };
        },
      });
    },
  } as unknown as Database;

  return { db, statements };
}

describe("retention cleanup", () => {
  it("runs batched cleanup for operational and audit data", async () => {
    const { db, statements } = fakeDatabase();

    const result = await runRetentionCleanup(db, new Date("2026-01-31T00:00:00.000Z"));

    expect(statements).toHaveLength(6);
    const sqlText = statements.join("\n");
    expect(sqlText).toContain("FOR UPDATE SKIP LOCKED");
    expect(sqlText).toContain("legal_hold_at");
    expect(sqlText).toContain("status_changed_at");
    expect(sqlText).toContain("terminal_at");
    expect(result).toEqual({
      sessions: 1,
      verificationTokens: 1,
      invites: 1,
      emailDeliveries: 1,
      auditLogs: 1,
    });
  });
});
