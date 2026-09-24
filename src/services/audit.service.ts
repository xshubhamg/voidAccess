import { and, asc, count, desc, eq, gte, lte } from "drizzle-orm";

import type { Database } from "../database/client.ts";
import { auditLogs, users } from "../database/schema/index.ts";
import { AppError } from "../utils/AppError.ts";

export type AuditWriter = Pick<Database, "insert">;

export interface AuditEvent {
  organizationId: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordAudit(db: AuditWriter, event: AuditEvent): Promise<void> {
  await db.insert(auditLogs).values({
    organizationId: event.organizationId,
    actorId: event.actorId,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId ?? null,
    metadata: event.metadata ?? {},
    ipAddress: event.ipAddress ?? null,
    userAgent: event.userAgent ?? null,
  });
}

export interface AuditListFilters {
  page: number;
  limit: number;
  actorId?: string;
  action?: string;
  resourceType?: string;
  from?: Date;
  to?: Date;
}

export async function listAuditLogs(
  db: Database,
  organizationId: string,
  filters: AuditListFilters,
): Promise<{ items: unknown[]; page: number; limit: number; total: number }> {
  const predicates = [eq(auditLogs.organizationId, organizationId)];

  if (filters.actorId) predicates.push(eq(auditLogs.actorId, filters.actorId));
  if (filters.action) predicates.push(eq(auditLogs.action, filters.action));
  if (filters.resourceType) predicates.push(eq(auditLogs.resourceType, filters.resourceType));
  if (filters.from) predicates.push(gte(auditLogs.createdAt, filters.from));
  if (filters.to) predicates.push(lte(auditLogs.createdAt, filters.to));

  const where = and(...predicates);
  const [items, [total]] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        organizationId: auditLogs.organizationId,
        actorId: auditLogs.actorId,
        actorEmail: users.email,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        metadata: auditLogs.metadata,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt), asc(auditLogs.id))
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit),
    db.select({ value: count() }).from(auditLogs).where(where),
  ]);

  return { items, page: filters.page, limit: filters.limit, total: Number(total?.value ?? 0) };
}

export function requireAuditFilters(filters: AuditListFilters): void {
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new AppError("Invalid audit date range", 400, "INVALID_AUDIT_DATE_RANGE");
  }
}
