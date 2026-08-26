import type { RequestHandler } from "express";

import { AppError } from "../utils/AppError.ts";

/**
 * Requires the resolved tenant membership to carry the system Owner role.
 * Must run after `resolveTenant`.
 */
export const requireOrgOwner: RequestHandler = (req, _res, next) => {
  if (req.membership?.roleName !== "Owner") {
    return next(
      new AppError("Only the organization owner can perform this action", 403, "OWNER_REQUIRED"),
    );
  }

  next();
};
