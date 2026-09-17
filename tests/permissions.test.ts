import { describe, expect, it } from "bun:test";

import { missingPermissions } from "../src/utils/permissions.ts";

describe("missingPermissions", () => {
  it("returns required permissions absent from granted", () => {
    expect(missingPermissions(["role.read", "role.create"], ["role.read", "member.read"])).toEqual([
      "role.create",
    ]);
  });

  it("returns empty when every required permission is granted", () => {
    expect(missingPermissions(["a.b"], ["a.b", "c.d"])).toEqual([]);
  });

  it("returns all requirements when nothing is granted", () => {
    expect(missingPermissions(["a.b", "c.d"], [])).toEqual(["a.b", "c.d"]);
  });

  it("preserves the order of the required list and deduplicates grants", () => {
    expect(missingPermissions(["z.z", "a.a"], ["a.a", "z.z", "z.z"])).toEqual([]);
    expect(missingPermissions(["b.b", "a.a"], ["a.a"])).toEqual(["b.b"]);
  });
});
