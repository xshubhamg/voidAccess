import { and, asc, count, eq, isNull } from "drizzle-orm";

import type { Database } from "../database/client.ts";
import { memberships, organizations, roles } from "../database/schema/index.ts";
import { recordAudit, type AuditEvent } from "./audit.service.ts";
import { AppError } from "../utils/AppError.ts";
import { isUniqueViolation } from "../utils/dbErrors.ts";
import { slugWithRandomSuffix, slugify } from "../utils/slug.ts";

const OWNER_ROLE_NAME = "Owner";
const SLUG_MAX_ATTEMPTS = 5;

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: Date;
}

export interface OrganizationListResult {
  items: OrganizationSummary[];
  page: number;
  limit: number;
  total: number;
}

interface CreateOrganizationInput {
  ownerId: string;
  name: string;
  audit?: (organization: OrganizationSummary) => AuditEvent;
}

/**
 * Creates an organization plus the creator's Owner membership atomically.
 *
 * The first attempt uses the plain slug derived from the name. If Postgres
 * rejects it as a duplicate, the whole transaction is retried with a random
 * suffix appended — retries must wrap the transaction because an aborted
 * Postgres transaction cannot continue issuing statements.
 */
export async function createOrganization(
  db: Database,
  input: CreateOrganizationInput,
): Promise<OrganizationSummary> {
  const baseSlug = slugify(input.name);

  for (let attempt = 0; attempt < SLUG_MAX_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? baseSlug : slugWithRandomSuffix(baseSlug);

    try {
      return await db.transaction(async (tx) => {
        const [ownerRole] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(and(isNull(roles.organizationId), eq(roles.name, OWNER_ROLE_NAME)))
          .limit(1);

        if (!ownerRole) {
          throw new AppError(
            "System roles are missing — run the database seed",
            500,
            "SYSTEM_ROLES_MISSING",
          );
        }

        const [organization] = await tx
          .insert(organizations)
          .values({
            name: input.name,
            slug,
            ownerId: input.ownerId,
          })
          .returning({
            id: organizations.id,
            name: organizations.name,
            slug: organizations.slug,
            ownerId: organizations.ownerId,
            createdAt: organizations.createdAt,
          });

        if (!organization) {
          throw new AppError("Failed to create organization", 500, "ORGANIZATION_CREATE_FAILED");
        }

        await tx.insert(memberships).values({
          userId: input.ownerId,
          organizationId: organization.id,
          roleId: ownerRole.id,
        });

        if (input.audit) {
          await recordAudit(tx, input.audit(organization));
        }

        return organization;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }

  throw new AppError(
    "Could not generate a unique organization slug",
    409,
    "SLUG_GENERATION_FAILED",
  );
}

export async function listOrganizations(
  db: Database,
  userId: string,
  pagination: { page: number; limit: number },
): Promise<OrganizationListResult> {
  const [items, [total]] = await Promise.all([
    db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        ownerId: organizations.ownerId,
        createdAt: organizations.createdAt,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(organizations.name), asc(organizations.id))
      .limit(pagination.limit)
      .offset((pagination.page - 1) * pagination.limit),
    db.select({ value: count() }).from(memberships).where(eq(memberships.userId, userId)),
  ]);

  return {
    items,
    page: pagination.page,
    limit: pagination.limit,
    total: Number(total?.value ?? 0),
  };
}

export async function updateOrganization(
  db: Database,
  input: { organizationId: string; name: string; audit?: AuditEvent },
): Promise<OrganizationSummary> {
  return db.transaction(async (tx) => {
    const [organization] = await tx
      .update(organizations)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(organizations.id, input.organizationId))
      .returning({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        ownerId: organizations.ownerId,
        createdAt: organizations.createdAt,
      });

    if (!organization) {
      throw new AppError("Organization not found", 404, "ORGANIZATION_NOT_FOUND");
    }

    if (input.audit) {
      await recordAudit(tx, input.audit);
    }

    return organization;
  });
}

export async function transferOrganizationOwnership(
  db: Database,
  input: { organizationId: string; newOwnerId: string; audit?: AuditEvent },
): Promise<{ organizationId: string; ownerId: string }> {
  return db.transaction(async (tx) => {
    const [organization] = await tx
      .select({ id: organizations.id, ownerId: organizations.ownerId })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .for("update")
      .limit(1);

    if (!organization) {
      throw new AppError("Organization not found", 404, "ORGANIZATION_NOT_FOUND");
    }

    if (organization.ownerId === input.newOwnerId) {
      throw new AppError("User is already the organization owner", 409, "OWNER_ALREADY_ASSIGNED");
    }

    const [target] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, input.organizationId),
          eq(memberships.userId, input.newOwnerId),
        ),
      )
      .for("update")
      .limit(1);

    if (!target) {
      throw new AppError("Member not found", 404, "MEMBER_NOT_FOUND");
    }

    const systemRoles = await tx
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(isNull(roles.organizationId));
    const ownerRole = systemRoles.find((role) => role.name === OWNER_ROLE_NAME);
    const memberRole = systemRoles.find((role) => role.name === "Member");

    if (!ownerRole || !memberRole) {
      throw new AppError(
        "System roles are missing — run the database seed",
        500,
        "SYSTEM_ROLES_MISSING",
      );
    }

    await tx.update(memberships).set({ roleId: ownerRole.id }).where(eq(memberships.id, target.id));
    await tx
      .update(memberships)
      .set({ roleId: memberRole.id })
      .where(
        and(
          eq(memberships.organizationId, input.organizationId),
          eq(memberships.userId, organization.ownerId),
        ),
      );
    await tx
      .update(organizations)
      .set({ ownerId: input.newOwnerId, updatedAt: new Date() })
      .where(eq(organizations.id, input.organizationId));

    if (input.audit) {
      await recordAudit(tx, input.audit);
    }

    return { organizationId: organization.id, ownerId: input.newOwnerId };
  });
}

export async function deleteOrganization(
  db: Database,
  input: { organizationId: string; audit?: AuditEvent },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [organization] = await tx
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .for("update")
      .limit(1);

    if (!organization) {
      throw new AppError("Organization not found", 404, "ORGANIZATION_NOT_FOUND");
    }

    if (input.audit) {
      await recordAudit(tx, input.audit);
    }

    await tx.delete(organizations).where(eq(organizations.id, input.organizationId));
  });
}
