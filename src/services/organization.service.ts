import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../database/client.ts";
import { memberships, organizations, roles } from "../database/schema/index.ts";
import { AppError } from "../utils/AppError.ts";
import { isUniqueViolation } from "../utils/dbErrors.ts";
import { slugWithRandomSuffix, slugify } from "../utils/slug.ts";

const OWNER_ROLE_NAME = "Owner";
const SLUG_MAX_ATTEMPTS = 5;

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

interface CreateOrganizationInput {
  ownerId: string;
  name: string;
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

export async function updateOrganization(
  db: Database,
  input: { organizationId: string; name: string },
): Promise<OrganizationSummary> {
  const [organization] = await db
    .update(organizations)
    .set({ name: input.name, updatedAt: new Date() })
    .where(eq(organizations.id, input.organizationId))
    .returning({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      createdAt: organizations.createdAt,
    });

  if (!organization) {
    throw new AppError("Organization not found", 404, "ORGANIZATION_NOT_FOUND");
  }

  return organization;
}

export async function deleteOrganization(db: Database, organizationId: string): Promise<void> {
  const [deleted] = await db
    .delete(organizations)
    .where(eq(organizations.id, organizationId))
    .returning({ id: organizations.id });

  if (!deleted) {
    throw new AppError("Organization not found", 404, "ORGANIZATION_NOT_FOUND");
  }
}
