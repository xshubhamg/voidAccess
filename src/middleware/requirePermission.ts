import type { RequestHandler } from "express";

import { db } from "../database/client.ts";
import { resolveRolePermissions } from "../services/permission.service.ts";
import { AppError } from "../utils/AppError.ts";
import { missingPermissions } from "../utils/permissions.ts";

/**
 * Requires the resolved tenant membership's role to hold ALL of the given
 * permission names. Must run after `authenticate` and `resolveTenant`.
 */
export function requirePermission(...required: string[]): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user) {
        throw new AppError("Authentication required", 401, "UNAUTHORIZED");
      }

      if (!req.membership) {
        throw new AppError(
          "Tenant context missing — resolveTenant must run first",
          500,
          "TENANT_CONTEXT_MISSING",
        );
      }

      const granted = await resolveRolePermissions(db, req.membership.roleId);
      const missing = missingPermissions(required, granted);

      if (missing.length > 0) {
        throw new AppError(
          `Missing required permission(s): ${missing.join(", ")}`,
          403,
          "PERMISSION_DENIED",
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
