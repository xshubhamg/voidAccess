import { Router } from "express";
import { sql } from "drizzle-orm";

import { db } from "../database/client.ts";

export const healthRouter: Router = Router();

healthRouter.get("/", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get("/ready", async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.status(200).json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
});
