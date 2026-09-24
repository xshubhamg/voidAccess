import * as z from "zod";

import { paginationSchema, uuidSchema } from "./common.schemas.ts";

export const auditQuerySchema = paginationSchema.extend({
  actorId: uuidSchema.optional(),
  action: z.string().trim().min(1).max(120).optional(),
  resourceType: z.string().trim().min(1).max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
