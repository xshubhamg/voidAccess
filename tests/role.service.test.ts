import { describe, expect, it } from "bun:test";

import type { Database } from "../src/database/client.ts";
import { listOrganizationRoles } from "../src/services/role.service.ts";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const organizationId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const systemRole = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: null,
  name: "Admin",
  description: null,
  isDefault: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  permissionVersion: 0,
};
const customRole = {
  id: "22222222-2222-4222-8222-222222222222",
  organizationId,
  name: "Deployer",
  description: null,
  isDefault: false,
  createdAt: new Date("2026-01-02T00:00:00Z"),
  permissionVersion: 1,
};

describe("listOrganizationRoles", () => {
  it("paginates roles and loads all permissions for the page", async () => {
    let ordering: SQL[] = [];
    let pagination: { limit?: number; offset?: number } = {};

    const roleChain = {
      where: () => roleChain,
      orderBy: (...values: SQL[]) => {
        ordering = values;
        return roleChain;
      },
      limit: (value: number) => {
        pagination.limit = value;
        return roleChain;
      },
      offset: (value: number) => {
        pagination.offset = value;
        return Promise.resolve([{ role: systemRole }, { role: customRole }]);
      },
    };
    const mappingChain = {
      innerJoin: () => mappingChain,
      where: async () => [
        { roleId: customRole.id, permissionName: "role.read" },
        { roleId: customRole.id, permissionName: "role.update" },
      ],
    };
    const db = {
      select: (fields: unknown) => {
        if (typeof fields === "object" && fields !== null && "value" in fields) {
          return { from: () => ({ where: async () => [{ value: 6 }] }) };
        }
        if (typeof fields === "object" && fields !== null && "role" in fields) {
          return { from: () => roleChain };
        }
        return { from: () => mappingChain };
      },
    } as unknown as Database;

    const result = await listOrganizationRoles(db, organizationId, { page: 2, limit: 2 });

    expect(result).toMatchObject({
      page: 2,
      limit: 2,
      total: 6,
      items: [
        { id: systemRole.id, permissions: [] },
        { id: customRole.id, permissions: ["role.read", "role.update"] },
      ],
    });
    expect(pagination).toEqual({ limit: 2, offset: 2 });
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(ordering[0]!).sql).toContain(
      '"roles"."organization_id" is null desc',
    );
  });
});
