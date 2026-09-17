import { Router } from "express";

import { db } from "../database/client.ts";
import { authenticate } from "../middleware/authenticate.ts";
import { requirePermission } from "../middleware/requirePermission.ts";
import { resolveTenant } from "../middleware/resolveTenant.ts";
import { validateRequest } from "../middleware/validateRequest.ts";
import { listMembers, removeMember, updateMemberRole } from "../services/membership.service.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import {
  memberParamsSchema,
  memberIdParamsSchema,
  updateMemberSchema,
} from "../validations/member.schemas.ts";

export const memberRouter: Router = Router({ mergeParams: true });

memberRouter.get(
  "/",
  authenticate,
  validateRequest({ params: memberParamsSchema }),
  resolveTenant,
  requirePermission("member.read"),
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    const members = await listMembers(db, req.organization.id);

    res.status(200).json({
      success: true,
      message: "Members retrieved",
      data: { members },
    });
  }),
);

memberRouter.patch(
  "/:userId",
  authenticate,
  validateRequest({ params: memberIdParamsSchema, body: updateMemberSchema }),
  resolveTenant,
  requirePermission("member.update"),
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    if (!req.user) {
      throw new AppError("Authentication required", 401, "UNAUTHORIZED");
    }

    const { userId } = req.params as { userId: string };

    const member = await updateMemberRole(db, {
      organizationId: req.organization.id,
      actorUserId: req.user.id,
      targetUserId: userId,
      roleId: req.body.roleId,
    });

    res.status(200).json({
      success: true,
      message: "Member updated",
      data: { member },
    });
  }),
);

memberRouter.delete(
  "/:userId",
  authenticate,
  validateRequest({ params: memberIdParamsSchema }),
  resolveTenant,
  requirePermission("member.remove"),
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    if (!req.user) {
      throw new AppError("Authentication required", 401, "UNAUTHORIZED");
    }

    const { userId } = req.params as { userId: string };

    await removeMember(db, {
      organizationId: req.organization.id,
      actorUserId: req.user.id,
      targetUserId: userId,
    });

    res.status(200).json({
      success: true,
      message: "Member removed",
    });
  }),
);
