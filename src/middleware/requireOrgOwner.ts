import type { RequestHandler } from "express";

import { AppError } from "../utils/AppError.ts";

export const requireOrgOwner: RequestHandler = (req, _res, next) => {
  if (!req.user || req.organization?.ownerId !== req.user.id) {
    return next(
      new AppError("Only the organization owner can perform this action", 403, "OWNER_REQUIRED"),
    );
  }

  next();
};
