import { isNull } from "drizzle-orm";
import { db } from "./client.ts";
import { permissions, rolePermissions, roles } from "./schema/index.ts";

interface PermissionSeed {
  name: string;
  description: string;
  resource: string;
  action: string;
}

interface RoleSeed {
  name: string;
  description: string;
  isDefault: boolean;
}

const PERMISSIONS: PermissionSeed[] = [
  {
    name: "organization.read",
    description: "View organization details",
    resource: "organization",
    action: "read",
  },
  {
    name: "organization.update",
    description: "Update organization settings",
    resource: "organization",
    action: "update",
  },
  {
    name: "organization.delete",
    description: "Delete the organization",
    resource: "organization",
    action: "delete",
  },
  {
    name: "member.read",
    description: "View organization members",
    resource: "member",
    action: "read",
  },
  {
    name: "member.invite",
    description: "Invite new members to the organization",
    resource: "member",
    action: "invite",
  },
  {
    name: "member.remove",
    description: "Remove members from the organization",
    resource: "member",
    action: "remove",
  },
  {
    name: "member.update",
    description: "Update member roles",
    resource: "member",
    action: "update",
  },
  {
    name: "role.read",
    description: "View organization roles",
    resource: "role",
    action: "read",
  },
  {
    name: "role.create",
    description: "Create new organization roles",
    resource: "role",
    action: "create",
  },
  {
    name: "role.update",
    description: "Update existing organization roles",
    resource: "role",
    action: "update",
  },
  {
    name: "role.delete",
    description: "Delete organization roles",
    resource: "role",
    action: "delete",
  },
  {
    name: "audit.read",
    description: "View audit logs",
    resource: "audit",
    action: "read",
  },
];

const SYSTEM_ROLES: RoleSeed[] = [
  {
    name: "Owner",
    description: "Full control over the organization and all resources",
    isDefault: false,
  },
  {
    name: "Admin",
    description: "Manage organization settings, members, and roles",
    isDefault: false,
  },
  {
    name: "Member",
    description: "Basic access to organization resources",
    isDefault: true,
  },
  {
    name: "Viewer",
    description: "Read-only access to organization resources",
    isDefault: false,
  },
];

const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  Owner: [
    "organization.read",
    "organization.update",
    "organization.delete",
    "member.read",
    "member.invite",
    "member.remove",
    "member.update",
    "role.read",
    "role.create",
    "role.update",
    "role.delete",
    "audit.read",
  ],
  Admin: [
    "organization.read",
    "organization.update",
    "member.read",
    "member.invite",
    "member.remove",
    "member.update",
    "role.read",
    "role.create",
    "role.update",
    "role.delete",
    "audit.read",
  ],
  Member: ["organization.read", "member.read", "role.read"],
  Viewer: ["organization.read", "member.read"],
};

async function seed() {
  console.log("Seeding database...\n");

  let insertedPermissions = 0;
  let insertedRoles = 0;
  let insertedMappings = 0;

  await db.transaction(async (tx) => {
    const permResult = await tx
      .insert(permissions)
      .values(PERMISSIONS)
      .onConflictDoNothing({ target: permissions.name })
      .returning({ id: permissions.id });

    insertedPermissions = permResult.length;

    const allPermissions = await tx.select().from(permissions);
    const permMap = new Map(allPermissions.map((p) => [p.name, p.id]));

    const existingRoles = await tx
      .select({ name: roles.name })
      .from(roles)
      .where(isNull(roles.organizationId));

    const existingRoleNames = new Set(existingRoles.map((r) => r.name));
    const newRoleDefs = SYSTEM_ROLES.filter((r) => !existingRoleNames.has(r.name));

    if (newRoleDefs.length > 0) {
      const result = await tx
        .insert(roles)
        .values(
          newRoleDefs.map((r) => ({
            name: r.name,
            description: r.description,
            isDefault: r.isDefault,
            organizationId: null,
          })),
        )
        .returning({ id: roles.id });

      insertedRoles = result.length;
    }

    const allSystemRoles = await tx
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(isNull(roles.organizationId));

    const roleMap = new Map(allSystemRoles.map((r) => [r.name, r.id]));

    const mappings: { roleId: string; permissionId: string }[] = [];
    for (const [roleName, permNames] of Object.entries(ROLE_PERMISSION_MAP)) {
      const roleId = roleMap.get(roleName);
      if (!roleId) {
        throw new Error(`Role "${roleName}" not found after seed — this should not happen`);
      }
      for (const permName of permNames) {
        const permId = permMap.get(permName);
        if (!permId) {
          throw new Error(`Permission "${permName}" not found after seed — this should not happen`);
        }
        mappings.push({ roleId, permissionId: permId });
      }
    }

    const mappingResult = await tx
      .insert(rolePermissions)
      .values(mappings)
      .onConflictDoNothing()
      .returning({ roleId: rolePermissions.roleId });

    insertedMappings = mappingResult.length;
  });

  console.log(
    `Permissions: ${insertedPermissions} inserted, ${PERMISSIONS.length - insertedPermissions} skipped (already exist)`,
  );
  console.log(
    `Roles: ${insertedRoles} inserted, ${SYSTEM_ROLES.length - insertedRoles} skipped (already exist)`,
  );
  console.log(`Role-permission mappings: ${insertedMappings} inserted`);
  console.log("\nSeed complete.");
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
