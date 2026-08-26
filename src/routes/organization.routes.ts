import { Router } from "express";

import { db } from "../database/client.ts";
import { authenticate } from "../middleware/authenticate.ts";
import { requireOrgOwner } from "../middleware/requireOrgOwner.ts";
import { resolveTenant } from "../middleware/resolveTenant.ts";
import { validateRequest } from "../middleware/validateRequest.ts";
import {
  createOrganization,
  deleteOrganization,
  updateOrganization,
} from "../services/organization.service.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import {
  createOrganizationSchema,
  organizationParamsSchema,
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
    });

    res.status(201).json({
      success: true,
      message: "Organization created",
      data: { organization },
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
    });

    res.status(200).json({
      success: true,
      message: "Organization updated",
      data: { organization },
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

    await deleteOrganization(db, req.organization.id);

    res.status(200).json({
      success: true,
      message: "Organization deleted",
    });
  }),
);
