import { describe, expect, it } from "bun:test";

import { isReservedRoleName } from "../src/validations/role.schemas.ts";
import {
  createRoleSchema,
  roleListQuerySchema,
  updateRoleSchema,
} from "../src/validations/role.schemas.ts";

describe("createRoleSchema", () => {
  it("accepts a valid role with defaults for description and permissions", () => {
    const result = createRoleSchema.parse({ name: "Deployer" });
    expect(result.name).toBe("Deployer");
    expect(result.description).toBeNull();
    expect(result.permissions).toEqual([]);
  });

  it("rejects reserved system role names case-insensitively", () => {
    for (const name of ["Owner", "admin", "MEMBER", "Viewer"]) {
      expect(() => createRoleSchema.parse({ name })).toThrow();
    }
  });

  it("allows names that merely contain reserved words", () => {
    const result = createRoleSchema.parse({ name: "Owner Assistant" });
    expect(result.name).toBe("Owner Assistant");
  });

  it("trims and lowercases permission names, rejecting malformed ones", () => {
    const result = createRoleSchema.parse({
      name: "Deployer",
      permissions: [" Role.Read ", "audit.read"],
    });
    expect(result.permissions).toEqual(["role.read", "audit.read"]);

    expect(() => createRoleSchema.parse({ name: "X", permissions: ["invalid"] })).toThrow();
    expect(() => createRoleSchema.parse({ name: "X", permissions: ["ROLE"] })).toThrow();
  });

  it("normalizes whitespace-only descriptions to null", () => {
    const result = createRoleSchema.parse({ name: "Deployer", description: "   " });
    expect(result.description).toBeNull();
  });

  it("caps name length at the column width", () => {
    expect(() => createRoleSchema.parse({ name: "x".repeat(81) })).toThrow();
    expect(createRoleSchema.parse({ name: "x".repeat(80) }).name).toHaveLength(80);
  });
});

describe("updateRoleSchema", () => {
  it("accepts partial updates", () => {
    expect(() => updateRoleSchema.parse({})).toThrow();
    expect(updateRoleSchema.parse({ name: "Renamed" }).name).toBe("Renamed");
  });

  it("distinguishes explicit null descriptions from omission", () => {
    const cleared = updateRoleSchema.parse({ description: null });
    expect(cleared.description).toBeNull();

    const untouched = updateRoleSchema.parse({ permissions: ["a.b"] });
    expect(untouched.description).toBeUndefined();
  });

  it("rejects unknown permission formats on update", () => {
    expect(() => updateRoleSchema.parse({ permissions: ["nope"] })).toThrow();
    expect(updateRoleSchema.parse({ permissions: [] }).permissions).toEqual([]);
  });

  it("rejects reserved names on update as well", () => {
    expect(() => updateRoleSchema.parse({ name: "owner" })).toThrow();
  });
});

describe("roleListQuerySchema", () => {
  it("uses bounded pagination defaults", () => {
    expect(roleListQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(() => roleListQuerySchema.parse({ limit: 101 })).toThrow();
  });
});

describe("isReservedRoleName", () => {
  it("matches ignoring case", () => {
    expect(isReservedRoleName("OWNER")).toBe(true);
    expect(isReservedRoleName("viewer")).toBe(true);
    expect(isReservedRoleName("Maintainer")).toBe(false);
  });
});
