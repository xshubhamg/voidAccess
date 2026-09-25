import { Router } from "express";

import { db } from "../database/client.ts";
import { authenticate } from "../middleware/authenticate.ts";
import { requirePermission } from "../middleware/requirePermission.ts";
import { resolveTenant } from "../middleware/resolveTenant.ts";
import { validateRequest } from "../middleware/validateRequest.ts";
import { listMembers, removeMember, updateMemberRole } from "../services/membership.service.ts";
import { AppError } from "../utils/AppError.ts";
import { requestAuditContext } from "../utils/auditContext.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import {
  memberListQuerySchema,
  memberParamsSchema,
  memberIdParamsSchema,
  updateMemberSchema,
} from "../validations/member.schemas.ts";

export const memberRouter: Router = Router({ mergeParams: true });

memberRouter.get(
  "/",
  authenticate,
  validateRequest({ params: memberParamsSchema, query: memberListQuerySchema }),
  resolveTenant,
  requirePermission("member.read"),
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    const result = await listMembers(db, req.organization.id, {
      page: Number(req.query.page),
      limit: Number(req.query.limit),
    });

    res.status(200).json({
      success: true,
      message: "Members retrieved",
      data: { items: result.items, page: result.page, limit: result.limit, total: result.total },
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
      audit: (updatedMember) => ({
        ...requestAuditContext(req),
        organizationId: req.organization?.id ?? null,
        actorId: req.user?.id ?? null,
        action: "member.role_updated",
        resourceType: "membership",
        resourceId: userId,
        metadata: { roleId: updatedMember.roleId, roleName: updatedMember.roleName },
      }),
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
      audit: {
        ...requestAuditContext(req),
        organizationId: req.organization.id,
        actorId: req.user.id,
        action: "member.removed",
        resourceType: "membership",
        resourceId: userId,
      },
    });

    res.status(200).json({
      success: true,
      message: "Member removed",
    });
  }),
);
