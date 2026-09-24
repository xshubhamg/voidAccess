import { Router } from "express";

import { db } from "../database/client.ts";
import { recordAudit } from "../services/audit.service.ts";
import { authenticate } from "../middleware/authenticate.ts";
import { requirePermission } from "../middleware/requirePermission.ts";
import { resolveTenant } from "../middleware/resolveTenant.ts";
import { validateRequest } from "../middleware/validateRequest.ts";
import {
  createRole,
  deleteRole,
  getOrganizationRole,
  listOrganizationRoles,
  updateRole,
} from "../services/role.service.ts";
import { AppError } from "../utils/AppError.ts";
import { requestAuditContext } from "../utils/auditContext.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import {
  createRoleSchema,
  roleIdParamsSchema,
  roleParamsSchema,
  updateRoleSchema,
} from "../validations/role.schemas.ts";

export const roleRouter: Router = Router({ mergeParams: true });

roleRouter.get(
  "/",
  authenticate,
  validateRequest({ params: roleParamsSchema }),
  resolveTenant,
  requirePermission("role.read"),
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    const roles = await listOrganizationRoles(db, req.organization.id);

    res.status(200).json({
      success: true,
      message: "Roles retrieved",
      data: { roles },
    });
  }),
);

roleRouter.post(
  "/",
  authenticate,
  validateRequest({ params: roleParamsSchema, body: createRoleSchema }),
  resolveTenant,
  requirePermission("role.create"),
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    const role = await createRole(db, {
      organizationId: req.organization.id,
      name: req.body.name,
      description: req.body.description,
      permissions: req.body.permissions,
    });
    await recordAudit(db, {
      ...requestAuditContext(req),
      organizationId: req.organization.id,
      actorId: req.user?.id ?? null,
      action: "role.created",
      resourceType: "role",
      resourceId: role.id,
      metadata: { name: role.name },
    });

    res.status(201).json({
      success: true,
      message: "Role created",
      data: { role },
    });
  }),
);

roleRouter.get(
  "/:roleId",
  authenticate,
  validateRequest({ params: roleIdParamsSchema }),
  resolveTenant,
  requirePermission("role.read"),
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    const { roleId } = req.params as { roleId: string };

    const role = await getOrganizationRole(db, {
      organizationId: req.organization.id,
      roleId,
    });

    res.status(200).json({
      success: true,
      message: "Role retrieved",
      data: { role },
    });
  }),
);

roleRouter.patch(
  "/:roleId",
  authenticate,
  validateRequest({ params: roleIdParamsSchema, body: updateRoleSchema }),
  resolveTenant,
  requirePermission("role.update"),
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    const { roleId } = req.params as { roleId: string };

    const role = await updateRole(db, {
      organizationId: req.organization.id,
      roleId,
      name: req.body.name,
      description: req.body.description,
      permissions: req.body.permissions,
    });
    await recordAudit(db, {
      ...requestAuditContext(req),
      organizationId: req.organization.id,
      actorId: req.user?.id ?? null,
      action: "role.updated",
      resourceType: "role",
      resourceId: role.id,
      metadata: { name: role.name, permissions: role.permissions },
    });

    res.status(200).json({
      success: true,
      message: "Role updated",
      data: { role },
    });
  }),
);

roleRouter.delete(
  "/:roleId",
  authenticate,
  validateRequest({ params: roleIdParamsSchema }),
  resolveTenant,
  requirePermission("role.delete"),
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    const { roleId } = req.params as { roleId: string };

    await deleteRole(db, {
      organizationId: req.organization.id,
      roleId,
    });
    await recordAudit(db, {
      ...requestAuditContext(req),
      organizationId: req.organization.id,
      actorId: req.user?.id ?? null,
      action: "role.deleted",
      resourceType: "role",
      resourceId: roleId,
    });

    res.status(200).json({
      success: true,
      message: "Role deleted",
    });
  }),
);
