import { eq } from "drizzle-orm";

import type { Database } from "../database/client.ts";
import { permissions, rolePermissions, roles } from "../database/schema/index.ts";
import { redis } from "../database/redis.ts";
import { logger } from "../utils/logger.ts";

const CACHE_TTL_SECONDS = 300;

function cacheKey(roleId: string, permissionVersion: number): string {
  return `rbac:role:${roleId}:v${permissionVersion}:permissions`;
}

/**
 * Resolves the permission names granted to a role via the role_permissions
 * join, serving results from a short-lived Redis cache keyed by role id.
 *
 * Cache failures never fail the request — they are logged and the database
 * is queried instead.
 */
export async function resolveRolePermissions(db: Database, roleId: string): Promise<string[]> {
  const [role] = await db
    .select({ permissionVersion: roles.permissionVersion })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);

  if (!role) {
    return [];
  }

  const key = cacheKey(roleId, role.permissionVersion);

  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      const names = JSON.parse(cached) as string[];
      const [currentRole] = await db
        .select({ permissionVersion: roles.permissionVersion })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);

      if (currentRole?.permissionVersion === role.permissionVersion) {
        return names;
      }
    }
  } catch (error) {
    logger.warn({ err: error, roleId }, "Permission cache read failed — querying database");
  }

  const rows = await db
    .select({ name: permissions.name })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, roleId));

  const names = rows.map((row) => row.name);

  try {
    await redis.set(key, JSON.stringify(names), "EX", CACHE_TTL_SECONDS);
  } catch (error) {
    logger.warn({ err: error, roleId }, "Permission cache write failed");
  }

  return names;
}

/** Drops the cached permission set for a role after its mappings change. */
export async function invalidateRolePermissionsCache(roleId: string): Promise<void> {
  try {
    const pattern = `rbac:role:${roleId}:v*:permissions`;
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch (error) {
    logger.warn({ err: error, roleId }, "Permission cache invalidation failed");
  }
}
