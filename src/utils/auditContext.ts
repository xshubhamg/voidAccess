import type { Request } from "express";

export function requestAuditContext(req: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.headers?.["user-agent"] ?? null,
  };
}
