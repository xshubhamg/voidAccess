import * as z from "zod";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Invalid email address"));

export const uuidSchema = z.uuid("Invalid UUID");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(256, "Password must be at most 256 characters")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const nonEmptyString = (field: string) => z.string().trim().min(1, `${field} is required`);
