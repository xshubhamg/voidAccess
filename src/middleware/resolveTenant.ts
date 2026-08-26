import type { RequestHandler } from "express";
import { and, eq } from "drizzle-orm";

import { db } from "../database/client.ts";
import { memberships, organizations, roles } from "../database/schema/index.ts";
import { AppError } from "../utils/AppError.ts";

export interface TenantOrganization {
  id: string;
  name: string;
  slug: string;
}

export interface TenantMembership {
  roleId: string;
  roleName: string;
}

/**
 * Resolves the organization referenced by the `orgId` route param and the
 * requester's membership within it.
 *
 * A missing row is reported identically whether the organization does not
 * exist or the caller is not a member, so valid tokens cannot be used to
 * enumerate organizations.
 */
export const resolveTenant: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.user) {
      throw new AppError("Authentication required", 401, "UNAUTHORIZED");
    }

    const orgId = (req.params as { orgId?: string }).orgId;

    if (!orgId) {
      throw new AppError("Missing organization id", 500, "TENANT_PARAM_MISSING");
    }

    const [row] = await db
      .select({
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
        roleId: roles.id,
        roleName: roles.name,
      })
      .from(organizations)
      .innerJoin(
        memberships,
        and(eq(memberships.organizationId, organizations.id), eq(memberships.userId, req.user.id)),
      )
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!row) {
      throw new AppError("Organization not found", 404, "ORGANIZATION_NOT_FOUND");
    }

    req.organization = {
      id: row.organizationId,
      name: row.organizationName,
      slug: row.organizationSlug,
    };
    req.membership = {
      roleId: row.roleId,
      roleName: row.roleName,
    };

    next();
  } catch (error) {
    next(error);
  }
};
