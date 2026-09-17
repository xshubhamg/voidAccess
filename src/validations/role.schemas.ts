import * as z from "zod";

import { nonEmptyString, uuidSchema } from "./common.schemas.ts";

export const RESERVED_ROLE_NAMES = ["Owner", "Admin", "Member", "Viewer"] as const;

export function isReservedRoleName(name: string): boolean {
  return RESERVED_ROLE_NAMES.some((reserved) => reserved.toLowerCase() === name.toLowerCase());
}

const permissionNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/,
    'Invalid permission name — expected "resource.action"',
  );

const roleNameSchema = nonEmptyString("Name")
  .max(80, "Name must be at most 80 characters")
  .refine((name) => !isReservedRoleName(name), {
    message: "Name is reserved for system roles",
  });

const roleDescriptionSchema = z
  .string()
  .trim()
  .max(500, "Description must be at most 500 characters")
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

export const createRoleSchema = z.object({
  name: roleNameSchema,
  description: roleDescriptionSchema.default(null),
  permissions: z
    .array(permissionNameSchema)
    .max(100, "At most 100 permissions are allowed")
    .default([]),
});

export const updateRoleSchema = z
  .object({
    name: roleNameSchema.optional(),
    description: roleDescriptionSchema.optional(),
    permissions: z
      .array(permissionNameSchema)
      .max(100, "At most 100 permissions are allowed")
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export const roleParamsSchema = z.object({
  orgId: uuidSchema,
});

export const roleIdParamsSchema = z.object({
  orgId: uuidSchema,
  roleId: uuidSchema,
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
