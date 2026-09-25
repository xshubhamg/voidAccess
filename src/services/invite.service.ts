import { randomBytes } from "node:crypto";

import { and, asc, count, desc, eq, lte, sql } from "drizzle-orm";

import { INVITE_EXPIRATION } from "../config/index.ts";
import type { Database } from "../database/client.ts";
import { invites, memberships, organizations, roles, users } from "../database/schema/index.ts";
import { recordAudit, type AuditEvent } from "./audit.service.ts";
import { enqueueInvitationEmail } from "./email-delivery.service.ts";
import { AppError } from "../utils/AppError.ts";
import { isUniqueViolation } from "../utils/dbErrors.ts";
import { hashToken, parseDurationMs } from "../utils/tokens.ts";

const INVITE_TTL_MS = parseDurationMs(INVITE_EXPIRATION);
const OWNER_ROLE_NAME = "Owner";

export interface InviteSummary {
  id: string;
  organizationId: string;
  email: string;
  roleId: string;
  roleName: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
}

function createInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

function toInviteSummary(row: {
  id: string;
  organizationId: string;
  email: string;
  roleId: string;
  roleName: string;
  status: InviteSummary["status"];
  expiresAt: Date;
  createdAt: Date;
  acceptedAt: Date | null;
}): InviteSummary {
  return row;
}

export async function createInvite(
  db: Database,
  input: {
    organizationId: string;
    invitedByUserId: string;
    email: string;
    roleId: string;
    audit?: (invite: InviteSummary) => AuditEvent;
  },
): Promise<{ invite: InviteSummary; token: string }> {
  const token = createInviteToken();

  try {
    return await db.transaction(async (tx) => {
      const [role] = await tx
        .select({ id: roles.id, name: roles.name, organizationId: roles.organizationId })
        .from(roles)
        .where(eq(roles.id, input.roleId))
        .limit(1);

      if (
        !role ||
        (role.organizationId !== null && role.organizationId !== input.organizationId) ||
        (role.organizationId === null && role.name === OWNER_ROLE_NAME)
      ) {
        throw new AppError("Role not found", 404, "ROLE_NOT_FOUND");
      }

      const [invitee] = await tx
        .select({ id: users.id, emailVerified: users.emailVerified })
        .from(users)
        .where(sql`lower(${users.email}) = ${input.email}`)
        .limit(1);

      if (!invitee?.emailVerified) {
        throw new AppError(
          "Invitations require an existing email-verified account",
          400,
          "INVITEE_NOT_ELIGIBLE",
        );
      }

      await tx
        .update(invites)
        .set({ status: "expired" })
        .where(
          and(
            eq(invites.organizationId, input.organizationId),
            sql`lower(${invites.email}) = ${input.email}`,
            eq(invites.status, "pending"),
            lte(invites.expiresAt, new Date()),
          ),
        );

      const [invite] = await tx
        .insert(invites)
        .values({
          organizationId: input.organizationId,
          invitedByUserId: input.invitedByUserId,
          email: input.email,
          roleId: input.roleId,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        })
        .returning({
          id: invites.id,
          organizationId: invites.organizationId,
          email: invites.email,
          roleId: invites.roleId,
          status: invites.status,
          expiresAt: invites.expiresAt,
          createdAt: invites.createdAt,
          acceptedAt: invites.acceptedAt,
        });

      if (!invite) {
        throw new AppError("Failed to create invitation", 500, "INVITE_CREATE_FAILED");
      }

      const [withRole] = await tx
        .select({ roleName: roles.name })
        .from(roles)
        .where(eq(roles.id, invite.roleId))
        .limit(1);
      const [organization] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1);

      await enqueueInvitationEmail(tx, {
        to: input.email,
        token,
        organizationName: organization?.name ?? "the organization",
        inviteId: invite.id,
      });

      if (input.audit) {
        await recordAudit(
          tx,
          input.audit(toInviteSummary({ ...invite, roleName: withRole?.roleName ?? "Unknown" })),
        );
      }

      return {
        invite: toInviteSummary({ ...invite, roleName: withRole?.roleName ?? "Unknown" }),
        token,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(
        "A pending invitation already exists for this email",
        409,
        "INVITE_ALREADY_EXISTS",
      );
    }
    throw error;
  }
}

export async function listInvites(
  db: Database,
  organizationId: string,
  pagination: { page: number; limit: number },
): Promise<{ items: InviteSummary[]; page: number; limit: number; total: number }> {
  const [items, [total]] = await Promise.all([
    db
      .select({
        id: invites.id,
        organizationId: invites.organizationId,
        email: invites.email,
        roleId: invites.roleId,
        roleName: roles.name,
        status: invites.status,
        expiresAt: invites.expiresAt,
        createdAt: invites.createdAt,
        acceptedAt: invites.acceptedAt,
      })
      .from(invites)
      .innerJoin(roles, eq(roles.id, invites.roleId))
      .where(eq(invites.organizationId, organizationId))
      .orderBy(desc(invites.createdAt), asc(invites.id))
      .limit(pagination.limit)
      .offset((pagination.page - 1) * pagination.limit),
    db.select({ value: count() }).from(invites).where(eq(invites.organizationId, organizationId)),
  ]);

  return {
    items,
    page: pagination.page,
    limit: pagination.limit,
    total: Number(total?.value ?? 0),
  };
}

export async function revokeInvite(
  db: Database,
  input: { organizationId: string; inviteId: string; audit?: AuditEvent },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [revoked] = await tx
      .update(invites)
      .set({ status: "revoked" })
      .where(
        and(
          eq(invites.organizationId, input.organizationId),
          eq(invites.id, input.inviteId),
          eq(invites.status, "pending"),
        ),
      )
      .returning({ id: invites.id });

    if (revoked) {
      if (input.audit) await recordAudit(tx, input.audit);
      return;
    }

    const [existing] = await tx
      .select({ id: invites.id })
      .from(invites)
      .where(and(eq(invites.organizationId, input.organizationId), eq(invites.id, input.inviteId)))
      .limit(1);

    if (!existing) throw new AppError("Invitation not found", 404, "INVITE_NOT_FOUND");
    throw new AppError("Invitation is not pending", 409, "INVITE_NOT_PENDING");
  });
}

export async function acceptInvite(
  db: Database,
  input: {
    userId: string;
    token: string;
    audit?: (result: { organizationId: string; roleId: string }) => AuditEvent;
  },
): Promise<{ organizationId: string; roleId: string }> {
  const now = new Date();
  const tokenHash = hashToken(input.token);

  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, tokenHash))
      .for("update")
      .limit(1);

    if (!invite) {
      throw new AppError("Invitation is invalid or expired", 400, "INVALID_INVITE");
    }

    if (invite.status !== "pending") {
      throw new AppError("Invitation is no longer active", 409, "INVITE_NOT_PENDING");
    }

    if (invite.expiresAt <= now) {
      await tx.update(invites).set({ status: "expired" }).where(eq(invites.id, invite.id));
      throw new AppError("Invitation is invalid or expired", 400, "INVITE_EXPIRED");
    }

    const [user] = await tx
      .select({ id: users.id, email: users.email, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);

    if (!user || !user.emailVerified || user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new AppError(
        "Invitation is not valid for this account",
        403,
        "INVITE_ACCOUNT_MISMATCH",
      );
    }

    const [existingMembership] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(eq(memberships.organizationId, invite.organizationId), eq(memberships.userId, user.id)),
      )
      .limit(1);

    if (existingMembership) {
      throw new AppError("User is already a member of this organization", 409, "ALREADY_A_MEMBER");
    }

    await tx.insert(memberships).values({
      userId: user.id,
      organizationId: invite.organizationId,
      roleId: invite.roleId,
    });
    await tx
      .update(invites)
      .set({ status: "accepted", acceptedAt: now })
      .where(eq(invites.id, invite.id));

    const result = { organizationId: invite.organizationId, roleId: invite.roleId };
    if (input.audit) {
      await recordAudit(tx, input.audit(result));
    }

    return result;
  });
}
