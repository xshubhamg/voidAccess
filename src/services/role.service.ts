import { and, count, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { Database } from "../database/client.ts";
import {
  memberships,
  invites,
  permissions,
  rolePermissions,
  roles,
} from "../database/schema/index.ts";
import { AppError } from "../utils/AppError.ts";
import { isUniqueViolation } from "../utils/dbErrors.ts";
import { invalidateRolePermissionsCache } from "./permission.service.ts";
import { recordAudit, type AuditEvent } from "./audit.service.ts";
import { isReservedRoleName } from "../validations/role.schemas.ts";

export interface RoleSummary {
  id: string;
  organizationId: string | null;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: Date;
  permissions: string[];
}

interface CreateRoleInput {
  organizationId: string;
  name: string;
  description?: string | null;
  permissions?: string[];
  audit?: (role: RoleSummary) => AuditEvent;
}

interface UpdateRoleInput {
  organizationId: string;
  roleId: string;
  name?: string;
  description?: string | null;
  permissions?: string[];
  audit?: (role: RoleSummary) => AuditEvent;
}

interface DeleteRoleInput {
  organizationId: string;
  roleId: string;
  audit?: AuditEvent;
}

type RoleRow = typeof roles.$inferSelect;

/**
 * Lists every role visible inside an organization: its custom roles plus the
 * shared system roles, with resolved permission names. System roles come
 * first, both groups sorted alphabetically.
 */
export async function listOrganizationRoles(
  db: Database,
  organizationId: string,
): Promise<RoleSummary[]> {
  const rows = await db
    .select({
      role: roles,
      permissionName: permissions.name,
    })
    .from(roles)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(or(eq(roles.organizationId, organizationId), isNull(roles.organizationId)));

  const roleRows = new Map<string, RoleRow>();
  const permissionNamesById = new Map<string, string[]>();

  for (const row of rows) {
    if (!roleRows.has(row.role.id)) {
      roleRows.set(row.role.id, row.role);
      permissionNamesById.set(row.role.id, []);
    }
    if (row.permissionName !== null) {
      permissionNamesById.get(row.role.id)?.push(row.permissionName);
    }
  }

  return [...roleRows.entries()]
    .map(([roleId, role]) => toSummary(role, permissionNamesById.get(roleId) ?? []))
    .toSorted((a, b) => {
      const aIsSystem = a.organizationId === null;
      const bIsSystem = b.organizationId === null;

      if (aIsSystem !== bIsSystem) {
        return aIsSystem ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
}

/** Fetches a single role visible to the organization (custom or system). */
export async function getOrganizationRole(
  db: Database,
  input: { organizationId: string; roleId: string },
): Promise<RoleSummary> {
  const [row] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, input.roleId), roleVisibleTo(input.organizationId)))
    .limit(1);

  if (!row) {
    throw new AppError("Role not found", 404, "ROLE_NOT_FOUND");
  }

  const mappings = await db
    .select({ permissionName: permissions.name })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, row.id));

  return toSummary(
    row,
    mappings.map((mapping) => mapping.permissionName),
  );
}

/**
 * Creates an org-scoped custom role with its permission mappings atomically.
 * Reserved system role names are rejected so ownership checks keyed on the
 * "Owner" name can never be spoofed by a custom role.
 */
export async function createRole(db: Database, input: CreateRoleInput): Promise<RoleSummary> {
  if (isReservedRoleName(input.name)) {
    throw new AppError("Name is reserved for system roles", 409, "ROLE_NAME_RESERVED");
  }

  try {
    return await db.transaction(async (tx) => {
      const permissionIds = await resolvePermissionIds(tx, input.permissions ?? []);

      const [role] = await tx
        .insert(roles)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          description: input.description ?? null,
          isDefault: false,
        })
        .returning();

      if (!role) {
        throw new AppError("Failed to create role", 500, "ROLE_CREATE_FAILED");
      }

      if (permissionIds.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })));
      }

      const summary = toSummary(role, input.permissions ?? []);
      if (input.audit) {
        await recordAudit(tx, input.audit(summary));
      }
      return summary;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        "A role with this name already exists in the organization",
        409,
        "ROLE_ALREADY_EXISTS",
      );
    }
    throw error;
  }
}

/**
 * Updates a custom role's name, description, and/or permission set. System
 * roles are immutable and roles from other organizations are reported as
 * not found, so their existence cannot be probed.
 */
export async function updateRole(db: Database, input: UpdateRoleInput): Promise<RoleSummary> {
  try {
    const updated = await db.transaction(async (tx) => {
      const [role] = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.id, input.roleId), roleVisibleTo(input.organizationId)))
        .limit(1);

      if (!role) {
        throw new AppError("Role not found", 404, "ROLE_NOT_FOUND");
      }

      if (role.organizationId === null) {
        throw new AppError("System roles cannot be modified", 403, "SYSTEM_ROLE_IMMUTABLE");
      }

      let permissionNames: string[] | undefined;

      if (input.permissions !== undefined) {
        const permissionIds = await resolvePermissionIds(tx, input.permissions);

        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));

        if (permissionIds.length > 0) {
          await tx
            .insert(rolePermissions)
            .values(permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })));
        }

        permissionNames = [...new Set(input.permissions)];
      }

      const fieldChanges = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.permissions !== undefined
          ? { permissionVersion: sql`${roles.permissionVersion} + 1` }
          : {}),
      };

      let updatedRole: RoleRow | undefined = role;

      if (Object.keys(fieldChanges).length > 0) {
        const [row] = await tx
          .update(roles)
          .set(fieldChanges)
          .where(eq(roles.id, role.id))
          .returning();

        updatedRole = row;
      }

      if (!updatedRole) {
        throw new AppError("Failed to update role", 500, "ROLE_UPDATE_FAILED");
      }

      if (permissionNames === undefined) {
        const mappings = await tx
          .select({ permissionName: permissions.name })
          .from(rolePermissions)
          .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
          .where(eq(rolePermissions.roleId, role.id));

        permissionNames = mappings.map((mapping) => mapping.permissionName);
      }

      const summary = toSummary(updatedRole, permissionNames);
      if (input.audit) {
        await recordAudit(tx, input.audit(summary));
      }
      return summary;
    });

    await invalidateRolePermissionsCache(updated.id);

    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        "A role with this name already exists in the organization",
        409,
        "ROLE_ALREADY_EXISTS",
      );
    }
    throw error;
  }
}

/**
 * Deletes a custom role. Deletion is blocked while memberships still point at
 * the role or pending invites reference it — both FKs would otherwise cascade
 * away member access silently.
 */
export async function deleteRole(db: Database, input: DeleteRoleInput): Promise<void> {
  const deletedRoleId = await db.transaction(async (tx) => {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, input.roleId), roleVisibleTo(input.organizationId)))
      .for("update")
      .limit(1);

    if (!role) {
      throw new AppError("Role not found", 404, "ROLE_NOT_FOUND");
    }

    if (role.organizationId === null) {
      throw new AppError("System roles cannot be modified", 403, "SYSTEM_ROLE_IMMUTABLE");
    }

    const [memberUsage] = await tx
      .select({ total: count() })
      .from(memberships)
      .where(eq(memberships.roleId, role.id));

    if ((memberUsage?.total ?? 0) > 0) {
      throw new AppError("Role is still assigned to members", 409, "ROLE_IN_USE");
    }

    const [inviteUsage] = await tx
      .select({ total: count() })
      .from(invites)
      .where(and(eq(invites.roleId, role.id), eq(invites.status, "pending")));

    if ((inviteUsage?.total ?? 0) > 0) {
      throw new AppError("Role is referenced by pending invites", 409, "ROLE_IN_USE");
    }

    if (input.audit) {
      await recordAudit(tx, input.audit);
    }

    await tx.delete(roles).where(eq(roles.id, role.id));

    return role.id;
  });

  await invalidateRolePermissionsCache(deletedRoleId);
}

function roleVisibleTo(organizationId: string) {
  return or(eq(roles.organizationId, organizationId), isNull(roles.organizationId));
}

/** Normalizes a role row into the API summary with deterministically sorted permissions. */
function toSummary(role: RoleRow, permissionNames: string[]): RoleSummary {
  return {
    id: role.id,
    organizationId: role.organizationId,
    name: role.name,
    description: role.description,
    isDefault: role.isDefault,
    createdAt: role.createdAt,
    permissions: [...permissionNames].toSorted(),
  };
}

async function resolvePermissionIds(
  tx: Pick<Database, "select">,
  names: string[],
): Promise<string[]> {
  const uniqueNames = [...new Set(names)];

  if (uniqueNames.length === 0) {
    return [];
  }

  const known = await tx
    .select({ id: permissions.id, name: permissions.name })
    .from(permissions)
    .where(inArray(permissions.name, uniqueNames));

  const knownNames = new Set(known.map((permission) => permission.name));
  const unknown = uniqueNames.filter((name) => !knownNames.has(name));

  if (unknown.length > 0) {
    throw new AppError(`Unknown permission(s): ${unknown.join(", ")}`, 400, "UNKNOWN_PERMISSIONS");
  }

  return known.map((permission) => permission.id);
}
