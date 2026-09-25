import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Pool } from "pg";

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const pool = process.env.TEST_DATABASE_URL
  ? new Pool({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5_000 })
  : null;

const expectedTables = [
  "audit_logs",
  "email_deliveries",
  "email_verification_tokens",
  "invites",
  "memberships",
  "organizations",
  "permissions",
  "role_permissions",
  "roles",
  "sessions",
  "users",
];

const expectedColumns = [
  ["email_deliveries", "source_type"],
  ["email_deliveries", "source_id"],
  ["email_deliveries", "source_token_hash"],
  ["email_deliveries", "lease_id"],
  ["email_deliveries", "terminal_at"],
  ["email_deliveries", "legal_hold_at"],
  ["email_verification_tokens", "legal_hold_at"],
  ["invites", "status_changed_at"],
  ["invites", "legal_hold_at"],
  ["sessions", "status_changed_at"],
  ["sessions", "legal_hold_at"],
  ["audit_logs", "legal_hold_at"],
] as const;

integration("database migration smoke", () => {
  beforeAll(async () => {
    await pool?.query("SELECT 1");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("connects to PostgreSQL", async () => {
    const result = await pool!.query<{ value: number }>("SELECT 1 AS value");
    expect(result.rows[0]?.value).toBe(1);
  });

  it("contains every current application table", async () => {
    const tables = await pool!.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining(expectedTables),
    );
  });

  it("contains the outbox and retention safety columns on the expected tables", async () => {
    const columns = await pool!.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'`,
    );
    const actual = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
    for (const [table, column] of expectedColumns) {
      expect(actual.has(`${table}.${column}`)).toBe(true);
    }
  });

  it("uses restrictive role foreign keys", async () => {
    const constraints = await pool!.query<{
      table_name: string;
      referenced_table: string;
      delete_action: string;
      update_action: string;
    }>(
      `SELECT conrelid::regclass::text AS table_name,
              confrelid::regclass::text AS referenced_table,
              confdeltype AS delete_action,
              confupdtype AS update_action
       FROM pg_constraint
       WHERE conrelid IN ('invites'::regclass, 'memberships'::regclass)
         AND contype = 'f'
         AND conname IN ('invites_role_id_roles_id_fk', 'memberships_role_id_roles_id_fk')`,
    );
    expect(constraints.rows).toHaveLength(2);
    expect(
      constraints.rows.map((row) => [
        row.table_name,
        row.referenced_table,
        row.delete_action,
        row.update_action,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["invites", "roles", "r", "c"],
        ["memberships", "roles", "r", "c"],
      ]),
    );
  });
});
