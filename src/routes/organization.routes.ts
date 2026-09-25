import { Router } from "express";

import { db } from "../database/client.ts";
import { authenticate } from "../middleware/authenticate.ts";
import { requireOrgOwner } from "../middleware/requireOrgOwner.ts";
import { resolveTenant } from "../middleware/resolveTenant.ts";
import { validateRequest } from "../middleware/validateRequest.ts";
import {
  createOrganization,
  deleteOrganization,
  listOrganizations,
  transferOrganizationOwnership,
  updateOrganization,
} from "../services/organization.service.ts";
import { AppError } from "../utils/AppError.ts";
import { requestAuditContext } from "../utils/auditContext.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import {
  createOrganizationSchema,
  organizationListQuerySchema,
  organizationParamsSchema,
  transferOwnershipSchema,
  updateOrganizationSchema,
} from "../validations/organization.schemas.ts";

export const organizationRouter: Router = Router();

organizationRouter.post(
  "/",
  authenticate,
  validateRequest({ body: createOrganizationSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError("Authentication required", 401, "UNAUTHORIZED");
    }

    const organization = await createOrganization(db, {
      ownerId: req.user.id,
      name: req.body.name,
      audit: (createdOrganization) => ({
        ...requestAuditContext(req),
        organizationId: createdOrganization.id,
        actorId: req.user?.id ?? null,
        action: "organization.created",
        resourceType: "organization",
        resourceId: createdOrganization.id,
      }),
    });

    res.status(201).json({
      success: true,
      message: "Organization created",
      data: { organization },
    });
  }),
);

organizationRouter.get(
  "/",
  authenticate,
  validateRequest({ query: organizationListQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError("Authentication required", 401, "UNAUTHORIZED");
    }

    const result = await listOrganizations(db, req.user.id, {
      page: Number(req.query.page),
      limit: Number(req.query.limit),
    });

    res.status(200).json({
      success: true,
      message: "Organizations retrieved",
      data: result,
    });
  }),
);

organizationRouter.patch(
  "/:orgId",
  authenticate,
  validateRequest({
    params: organizationParamsSchema,
    body: updateOrganizationSchema,
  }),
  resolveTenant,
  requireOrgOwner,
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    const organization = await updateOrganization(db, {
      organizationId: req.organization.id,
      name: req.body.name,
      audit: {
        ...requestAuditContext(req),
        organizationId: req.organization.id,
        actorId: req.user?.id ?? null,
        action: "organization.updated",
        resourceType: "organization",
        resourceId: req.organization.id,
        metadata: { name: req.body.name },
      },
    });

    res.status(200).json({
      success: true,
      message: "Organization updated",
      data: { organization },
    });
  }),
);

organizationRouter.post(
  "/:orgId/transfer-ownership",
  authenticate,
  validateRequest({
    params: organizationParamsSchema,
    body: transferOwnershipSchema,
  }),
  resolveTenant,
  requireOrgOwner,
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    const result = await transferOrganizationOwnership(db, {
      organizationId: req.organization.id,
      newOwnerId: req.body.userId,
      audit: {
        ...requestAuditContext(req),
        organizationId: req.organization.id,
        actorId: req.user?.id ?? null,
        action: "organization.ownership_transferred",
        resourceType: "organization",
        resourceId: req.organization.id,
        metadata: { newOwnerId: req.body.userId },
      },
    });

    res.status(200).json({
      success: true,
      message: "Organization ownership transferred",
      data: result,
    });
  }),
);

organizationRouter.delete(
  "/:orgId",
  authenticate,
  validateRequest({ params: organizationParamsSchema }),
  resolveTenant,
  requireOrgOwner,
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    await deleteOrganization(db, {
      organizationId: req.organization.id,
      audit: {
        ...requestAuditContext(req),
        organizationId: req.organization.id,
        actorId: req.user?.id ?? null,
        action: "organization.deleted",
        resourceType: "organization",
        resourceId: req.organization.id,
        metadata: { name: req.organization.name },
      },
    });

    res.status(200).json({
      success: true,
      message: "Organization deleted",
    });
  }),
);
