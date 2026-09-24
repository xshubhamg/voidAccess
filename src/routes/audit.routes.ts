import { Router } from "express";

import { db } from "../database/client.ts";
import { authenticate } from "../middleware/authenticate.ts";
import { requirePermission } from "../middleware/requirePermission.ts";
import { resolveTenant } from "../middleware/resolveTenant.ts";
import { validateRequest } from "../middleware/validateRequest.ts";
import { listAuditLogs, requireAuditFilters } from "../services/audit.service.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { auditQuerySchema } from "../validations/audit.schemas.ts";
import { organizationParamsSchema } from "../validations/organization.schemas.ts";

export const auditRouter: Router = Router();

auditRouter.get(
  "/organizations/:orgId/audit-logs",
  authenticate,
  validateRequest({ params: organizationParamsSchema, query: auditQuerySchema }),
  resolveTenant,
  requirePermission("audit.read"),
  asyncHandler(async (req, res) => {
    if (!req.organization) {
      throw new AppError("Tenant context missing", 500, "TENANT_CONTEXT_MISSING");
    }

    const filters = {
      page: Number(req.query.page),
      limit: Number(req.query.limit),
      actorId: typeof req.query.actorId === "string" ? req.query.actorId : undefined,
      action: typeof req.query.action === "string" ? req.query.action : undefined,
      resourceType: typeof req.query.resourceType === "string" ? req.query.resourceType : undefined,
      from: req.query.from instanceof Date ? req.query.from : undefined,
      to: req.query.to instanceof Date ? req.query.to : undefined,
    };
    requireAuditFilters(filters);
    const result = await listAuditLogs(db, req.organization.id, filters);

    res.status(200).json({
      success: true,
      message: "Audit logs retrieved",
      data: result,
    });
  }),
);
