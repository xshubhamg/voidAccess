import * as z from "zod";

import { uuidSchema } from "./common.schemas.ts";

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
