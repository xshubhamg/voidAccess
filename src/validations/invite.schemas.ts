import * as z from "zod";

import { emailSchema, nonEmptyString, paginationSchema, uuidSchema } from "./common.schemas.ts";

export const createInviteSchema = z.object({
  email: emailSchema,
  roleId: uuidSchema,
});

export const inviteCollectionParamsSchema = z.object({
  orgId: uuidSchema,
});

export const inviteParamsSchema = inviteCollectionParamsSchema.extend({
  inviteId: uuidSchema,
});

export const inviteAcceptanceSchema = z.object({
  token: nonEmptyString("Invitation token"),
});

export const inviteListQuerySchema = paginationSchema;

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
