import { and, asc, count, eq } from "drizzle-orm";

import type { Database } from "../database/client.ts";
import { memberships, organizations, roles, users } from "../database/schema/index.ts";
import { recordAudit, type AuditEvent } from "./audit.service.ts";
import { AppError } from "../utils/AppError.ts";

const OWNER_ROLE_NAME = "Owner";

export interface MemberSummary {
  userId: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  joinedAt: Date;
}

export interface MembershipSummary {
  userId: string;
  organizationId: string;
  roleId: string;
  roleName: string;
  joinedAt: Date;
}

interface UpdateMemberRoleInput {
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
  roleId: string;
  audit?: (member: MembershipSummary) => AuditEvent;
}

interface RemoveMemberInput {
  organizationId: string;
  actorUserId: string;
  targetUserId: string;
  audit?: AuditEvent;
}

/**
 * Assigns a role to an existing member of the organization.
 *
 * Guards:
 * - the target must already be a member (404 otherwise, anti-enumeration);
 * - the organization owner's own membership can never be reassigned;
 * - only the owner may grant the system Owner role;
 * - the target role must be a system role or belong to the same organization.
 */
export async function updateMemberRole(
  db: Database,
  input: UpdateMemberRoleInput,
): Promise<MembershipSummary> {
  return db.transaction(async (tx) => {
    const [organization] = await tx
      .select({ id: organizations.id, ownerId: organizations.ownerId })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1);

    if (!organization) {
      throw new AppError("Organization not found", 404, "ORGANIZATION_NOT_FOUND");
    }

    const [target] = await tx
      .select({ id: memberships.id, userId: memberships.userId, joinedAt: memberships.joinedAt })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, input.organizationId),
          eq(memberships.userId, input.targetUserId),
        ),
      )
      .limit(1);

    if (!target) {
      throw new AppError("Member not found", 404, "MEMBER_NOT_FOUND");
    }

    if (target.userId === organization.ownerId) {
      throw new AppError(
        "The organization owner's role cannot be changed",
        403,
        "OWNER_ROLE_LOCKED",
      );
    }

    const [newRole] = await tx
      .select({ id: roles.id, name: roles.name, organizationId: roles.organizationId })
      .from(roles)
      .where(eq(roles.id, input.roleId))
      .limit(1);

    if (
      !newRole ||
      (newRole.organizationId !== null && newRole.organizationId !== input.organizationId)
    ) {
      throw new AppError("Role not found", 404, "ROLE_NOT_FOUND");
    }

    const grantsOwnerRole = newRole.organizationId === null && newRole.name === OWNER_ROLE_NAME;

    if (grantsOwnerRole) {
      throw new AppError(
        "The Owner role can only be assigned through ownership transfer",
        403,
        "OWNER_ASSIGNMENT_FORBIDDEN",
      );
    }

    await tx.update(memberships).set({ roleId: newRole.id }).where(eq(memberships.id, target.id));

    const membership = {
      userId: target.userId,
      organizationId: organization.id,
      roleId: newRole.id,
      roleName: newRole.name,
      joinedAt: target.joinedAt,
    };
    if (input.audit) {
      await recordAudit(tx, input.audit(membership));
    }

    return membership;
  });
}

export async function listMembers(
  db: Database,
  organizationId: string,
  pagination: { page: number; limit: number },
): Promise<{ items: MemberSummary[]; page: number; limit: number; total: number }> {
  const [rows, [total]] = await Promise.all([
    db
      .select({
        userId: memberships.userId,
        email: users.email,
        name: users.name,
        roleId: memberships.roleId,
        roleName: roles.name,
        joinedAt: memberships.joinedAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(eq(memberships.organizationId, organizationId))
      .orderBy(asc(memberships.joinedAt), asc(memberships.userId))
      .limit(pagination.limit)
      .offset((pagination.page - 1) * pagination.limit),
    db
      .select({ value: count() })
      .from(memberships)
      .where(eq(memberships.organizationId, organizationId)),
  ]);

  return {
    items: rows.map((row) => ({
      userId: row.userId,
      email: row.email,
      name: row.name,
      roleId: row.roleId,
      roleName: row.roleName,
      joinedAt: row.joinedAt,
    })),
    page: pagination.page,
    limit: pagination.limit,
    total: Number(total?.value ?? 0),
  };
}

export async function removeMember(db: Database, input: RemoveMemberInput): Promise<void> {
  await db.transaction(async (tx) => {
    const [organization] = await tx
      .select({ id: organizations.id, ownerId: organizations.ownerId })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1);

    if (!organization) {
      throw new AppError("Organization not found", 404, "ORGANIZATION_NOT_FOUND");
    }

    const [target] = await tx
      .select({ id: memberships.id, userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, input.organizationId),
          eq(memberships.userId, input.targetUserId),
        ),
      )
      .limit(1);

    if (!target) {
      throw new AppError("Member not found", 404, "MEMBER_NOT_FOUND");
    }

    if (target.userId === organization.ownerId) {
      throw new AppError("The organization owner cannot be removed", 403, "OWNER_REMOVE_FORBIDDEN");
    }

    await tx.delete(memberships).where(eq(memberships.id, target.id));
    if (input.audit) {
      await recordAudit(tx, input.audit);
    }
  });
}
