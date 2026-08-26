import * as z from "zod";

import { emailSchema, nonEmptyString, passwordSchema } from "./common.schemas.ts";

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nonEmptyString("Name").max(120, "Name must be at most 120 characters"),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const refreshTokenSchema = z.object({
  refreshToken: nonEmptyString("Refresh token"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
