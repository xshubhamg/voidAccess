import * as z from "zod";

import { paginationSchema, uuidSchema } from "./common.schemas.ts";

export const memberListQuerySchema = paginationSchema;

export const memberParamsSchema = z.object({
  orgId: uuidSchema,
});

export const memberIdParamsSchema = z.object({
  orgId: uuidSchema,
  userId: uuidSchema,
});

export const updateMemberSchema = z.object({
  roleId: uuidSchema,
});
