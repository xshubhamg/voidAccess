import * as z from "zod";

import { emailSchema, nonEmptyString, paginationSchema, uuidSchema } from "./common.schemas.ts";

export const createInviteSchema = z.object({
  email: emailSchema,
  roleId: uuidSchema,
});

export const inviteParamsSchema = z.object({
  orgId: uuidSchema,
  inviteId: uuidSchema,
});

export const inviteAcceptanceSchema = z.object({
  token: nonEmptyString("Invitation token"),
});

export const inviteListQuerySchema = paginationSchema;

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
