import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { Database } from "../src/database/client.ts";

class FakeRedis {
  store = new Map<string, string>();
  failures: { get?: boolean; set?: boolean; del?: boolean } = {};
  setCalls: Array<{ key: string; args: unknown[] }> = [];

  async get(key: string): Promise<string | null> {
    if (this.failures.get) {
      throw new Error("redis down");
    }
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<"OK"> {
    if (this.failures.set) {
      throw new Error("redis down");
    }
    this.store.set(key, value);
    this.setCalls.push({ key, args });
    return "OK";
  }

  async del(key: string): Promise<number> {
    if (this.failures.del) {
      throw new Error("redis down");
    }
    return this.store.delete(key) ? 1 : 0;
  }
}

const fakeRedis = new FakeRedis();

mock.module("../src/database/redis.ts", () => ({
  redis: fakeRedis,
  connectRedis: async () => {},
  closeRedis: async () => {},
}));

const { resolveRolePermissions, invalidateRolePermissionsCache } =
  await import("../src/services/permission.service.ts");

const ROLE_ID = "11111111-2222-3333-4444-555555555555";
const CACHE_KEY = `rbac:role:${ROLE_ID}:permissions`;

function makeFakeDb(permissionNames: string[]) {
  let dbQueries = 0;

  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => {
            dbQueries += 1;
            return Promise.resolve(permissionNames.map((name) => ({ name })));
          },
        }),
      }),
    }),
  };

  return { db: db as unknown as Database, queries: () => dbQueries };
}

beforeEach(() => {
  fakeRedis.store.clear();
  fakeRedis.setCalls.length = 0;
  fakeRedis.failures = {};
});

describe("resolveRolePermissions", () => {
  it("serves the cached set without querying the database", async () => {
    const fake = makeFakeDb(["stale.permission"]);

    fakeRedis.store.set(CACHE_KEY, JSON.stringify(["role.read", "role.write"]));

    await expect(resolveRolePermissions(fake.db, ROLE_ID)).resolves.toEqual([
      "role.read",
      "role.write",
    ]);
    expect(fake.queries()).toBe(0);
  });

  it("queries the database on a miss and caches the result with a TTL", async () => {
    const fake = makeFakeDb(["role.read", "audit.read"]);

    await expect(resolveRolePermissions(fake.db, ROLE_ID)).resolves.toEqual([
      "role.read",
      "audit.read",
    ]);
    expect(fake.queries()).toBe(1);

    expect(fakeRedis.store.get(CACHE_KEY)).toBe(JSON.stringify(["role.read", "audit.read"]));
    const [setCall] = fakeRedis.setCalls;
    expect(setCall).toEqual({ key: CACHE_KEY, args: ["EX", 300] });

    await resolveRolePermissions(fake.db, ROLE_ID);
    expect(fake.queries()).toBe(1);
  });

  it("falls back to the database when the cache read fails", async () => {
    const fake = makeFakeDb(["member.read"]);

    fakeRedis.failures.get = true;

    await expect(resolveRolePermissions(fake.db, ROLE_ID)).resolves.toEqual(["member.read"]);
    expect(fake.queries()).toBe(1);
  });

  it("returns the database result even when the cache write fails", async () => {
    const fake = makeFakeDb(["member.read"]);

    fakeRedis.failures.set = true;

    await expect(resolveRolePermissions(fake.db, ROLE_ID)).resolves.toEqual(["member.read"]);
    expect(fake.queries()).toBe(1);
  });
});

describe("invalidateRolePermissionsCache", () => {
  it("drops the cached set for the role", async () => {
    fakeRedis.store.set(CACHE_KEY, "[]");

    await invalidateRolePermissionsCache(ROLE_ID);

    expect(fakeRedis.store.has(CACHE_KEY)).toBe(false);
  });

  it("never throws when the cache is unavailable", async () => {
    fakeRedis.failures.del = true;

    await expect(invalidateRolePermissionsCache(ROLE_ID)).resolves.toBeUndefined();
  });
});
