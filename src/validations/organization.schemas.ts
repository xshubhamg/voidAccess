import * as z from "zod";

import { nonEmptyString, uuidSchema } from "./common.schemas.ts";

export const organizationNameSchema = nonEmptyString("Name").max(
  160,
  "Name must be at most 160 characters",
);

export const createOrganizationSchema = z.object({
  name: organizationNameSchema,
});

export const updateOrganizationSchema = z.object({
  name: organizationNameSchema,
});

export const organizationParamsSchema = z.object({
  orgId: uuidSchema,
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
