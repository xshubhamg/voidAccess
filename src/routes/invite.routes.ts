import { Router } from "express";

import { NODE_ENV } from "../config/index.ts";
import { db } from "../database/client.ts";
import { authenticate } from "../middleware/authenticate.ts";
import { requirePermission } from "../middleware/requirePermission.ts";
import { resolveTenant } from "../middleware/resolveTenant.ts";
import { validateRequest } from "../middleware/validateRequest.ts";
import {
  acceptInvite,
  createInvite,
  listInvites,
  revokeInvite,
} from "../services/invite.service.ts";
import { AppError } from "../utils/AppError.ts";
import { requestAuditContext } from "../utils/auditContext.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import {
  createInviteSchema,
  inviteAcceptanceSchema,
  inviteCollectionParamsSchema,
  inviteListQuerySchema,
  inviteParamsSchema,
} from "../validations/invite.schemas.ts";

export const inviteRouter: Router = Router();

inviteRouter.post(
  "/organizations/:orgId/invites",
  authenticate,
  validateRequest({ params: inviteCollectionParamsSchema, body: createInviteSchema }),
  resolveTenant,
  requirePermission("member.invite"),
  asyncHandler(async (req, res) => {
    if (!req.user || !req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    const organizationId = req.organization.id;
    const userId = req.user.id;
    const result = await createInvite(db, {
      organizationId,
      invitedByUserId: userId,
      email: req.body.email,
      roleId: req.body.roleId,
      audit: (invite) => ({
        ...requestAuditContext(req),
        organizationId,
        actorId: userId,
        action: "invite.created",
        resourceType: "invite",
        resourceId: invite.id,
        metadata: { email: invite.email, roleId: invite.roleId },
      }),
    });

    res.status(201).json({
      success: true,
      message: "Invitation created",
      data: {
        invite: result.invite,
        ...(NODE_ENV === "production" ? {} : { token: result.token }),
      },
    });
  }),
);

inviteRouter.get(
  "/organizations/:orgId/invites",
  authenticate,
  validateRequest({ params: inviteCollectionParamsSchema, query: inviteListQuerySchema }),
  resolveTenant,
  requirePermission("member.read"),
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    const result = await listInvites(db, req.organization.id, {
      page: Number(req.query.page),
      limit: Number(req.query.limit),
    });

    res.status(200).json({
      success: true,
      message: "Invitations retrieved",
      data: result,
    });
  }),
);

inviteRouter.delete(
  "/organizations/:orgId/invites/:inviteId",
  authenticate,
  validateRequest({ params: inviteParamsSchema }),
  resolveTenant,
  requirePermission("member.invite"),
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    await revokeInvite(db, {
      organizationId: req.organization.id,
      inviteId: req.params.inviteId as string,
      audit: {
        ...requestAuditContext(req),
        organizationId: req.organization.id,
        actorId: req.user?.id ?? null,
        action: "invite.revoked",
        resourceType: "invite",
        resourceId: req.params.inviteId as string,
      },
    });

    res.status(200).json({
      success: true,
      message: "Invitation revoked",
    });
  }),
);

inviteRouter.post(
  "/invites/accept",
  authenticate,
  validateRequest({ body: inviteAcceptanceSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError("Authentication required", 401, "UNAUTHORIZED");
    }

    const userId = req.user.id;
    const result = await acceptInvite(db, {
      userId,
      token: req.body.token,
      audit: (accepted) => ({
        ...requestAuditContext(req),
        organizationId: accepted.organizationId,
        actorId: userId,
        action: "invite.accepted",
        resourceType: "invite",
        metadata: { roleId: accepted.roleId },
      }),
    });

    res.status(200).json({
      success: true,
      message: "Invitation accepted",
      data: result,
    });
  }),
);
