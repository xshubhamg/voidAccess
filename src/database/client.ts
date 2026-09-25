import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DATABASE_URL } from "../config/index.ts";
import { logger } from "../utils/logger.ts";
import * as schema from "./schema/index.ts";

export const pool = new Pool({
  connectionString: DATABASE_URL,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (error) => {
  logger.error({ err: error }, "Unexpected PostgreSQL pool error");
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
export type DatabaseExecutor = Pick<Database, "select" | "insert" | "update" | "delete">;

export async function connectDatabase(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
