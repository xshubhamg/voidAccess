import { describe, expect, it } from "bun:test";

import type { Database } from "../src/database/client.ts";
import { memberships, organizations, roles } from "../src/database/schema/index.ts";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { listMembers, removeMember, updateMemberRole } from "../src/services/membership.service.ts";
import { AppError } from "../src/utils/AppError.ts";

const ORG_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OWNER_USER_ID = "11111111-2222-3333-4444-555555555555";
const MEMBER_USER_ID = "99999999-8888-7777-6666-555555555555";
const MEMBER_ROLE_ID = "a0000000-0000-0000-0000-000000000001";
const OWNER_ROLE_ID = "a0000000-0000-0000-0000-000000000002";
const FOREIGN_ROLE_ID = "a0000000-0000-0000-0000-000000000003";

const JOINED_AT = new Date("2026-08-01T00:00:00Z");

interface Scenario {
  org?: { id: string; ownerId: string };
  member?: { id: string; userId: string; joinedAt: Date };
  role?: { id: string; name: string; organizationId: string | null };
}

function selectChain(rows: unknown[]) {
  return {
    where: () => ({
      limit: () => Promise.resolve(rows),
    }),
  };
}

function makeFakeDb(scenario: Scenario) {
  const updates: Array<{ set: Record<string, unknown> }> = [];
  const deletions: Array<{ table: unknown; predicate: SQL }> = [];

  const tx = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => {
        if (table === organizations) return selectChain(scenario.org ? [scenario.org] : []);
        if (table === memberships) return selectChain(scenario.member ? [scenario.member] : []);
        if (table === roles) return selectChain(scenario.role ? [scenario.role] : []);
        return selectChain([]);
      },
    }),
    delete: (table: unknown) => ({
      where: async (predicate: SQL) => {
        deletions.push({ table, predicate });
      },
    }),
    update: (_table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          updates.push({ set });
          return Promise.resolve([]);
        },
      }),
    }),
  };

  const db = {
    transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as Database;

  return { db, updates, deletions };
}

const BASE_INPUT = {
  organizationId: ORG_ID,
  actorUserId: OWNER_USER_ID,
  targetUserId: MEMBER_USER_ID,
  roleId: MEMBER_ROLE_ID,
};

const BASE_SCENARIO: Scenario = {
  org: { id: ORG_ID, ownerId: OWNER_USER_ID },
  member: { id: "m-1", userId: MEMBER_USER_ID, joinedAt: JOINED_AT },
  role: { id: MEMBER_ROLE_ID, name: "Member", organizationId: null },
};

async function expectAppError(
  promise: Promise<unknown>,
  statusCode: number,
  errorCode: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).statusCode).toBe(statusCode);
  expect((caught as AppError).errorCode).toBe(errorCode);
}

describe("updateMemberRole", () => {
  it("assigns the role and returns a membership summary", async () => {
    const { db, updates } = makeFakeDb(BASE_SCENARIO);

    const summary = await updateMemberRole(db, BASE_INPUT);

    expect(summary).toEqual({
      userId: MEMBER_USER_ID,
      organizationId: ORG_ID,
      roleId: MEMBER_ROLE_ID,
      roleName: "Member",
      joinedAt: JOINED_AT,
    });
    expect(updates).toEqual([{ set: { roleId: MEMBER_ROLE_ID } }]);
  });

  it("rejects with 404 when the organization does not exist", async () => {
    const { db } = makeFakeDb({ ...BASE_SCENARIO, org: undefined });

    await expectAppError(updateMemberRole(db, BASE_INPUT), 404, "ORGANIZATION_NOT_FOUND");
  });

  it("rejects with 404 when the target is not a member", async () => {
    const { db } = makeFakeDb({ ...BASE_SCENARIO, member: undefined });

    await expectAppError(updateMemberRole(db, BASE_INPUT), 404, "MEMBER_NOT_FOUND");
  });

  it("locks the organization owner's own membership", async () => {
    const { db, updates } = makeFakeDb({
      ...BASE_SCENARIO,
      member: { id: "m-1", userId: OWNER_USER_ID, joinedAt: JOINED_AT },
    });

    await expectAppError(
      updateMemberRole(db, { ...BASE_INPUT, targetUserId: OWNER_USER_ID }),
      403,
      "OWNER_ROLE_LOCKED",
    );
    expect(updates).toHaveLength(0);
  });

  it("rejects roles scoped to another organization as not found", async () => {
    const { db } = makeFakeDb({
      ...BASE_SCENARIO,
      role: { id: FOREIGN_ROLE_ID, name: "Deployer", organizationId: "another-org" },
    });

    await expectAppError(
      updateMemberRole(db, { ...BASE_INPUT, roleId: FOREIGN_ROLE_ID }),
      404,
      "ROLE_NOT_FOUND",
    );
  });

  it("rejects a non-owner actor granting the system Owner role", async () => {
    const { db, updates } = makeFakeDb({
      ...BASE_SCENARIO,
      role: { id: OWNER_ROLE_ID, name: "Owner", organizationId: null },
    });

    await expectAppError(
      updateMemberRole(db, { ...BASE_INPUT, roleId: OWNER_ROLE_ID, actorUserId: "someone-else" }),
      403,
      "OWNER_ASSIGNMENT_FORBIDDEN",
    );
    expect(updates).toHaveLength(0);
  });

  it("allows the organization owner to grant the system Owner role", async () => {
    const { db, updates } = makeFakeDb({
      ...BASE_SCENARIO,
      role: { id: OWNER_ROLE_ID, name: "Owner", organizationId: null },
    });

    const summary = await updateMemberRole(db, { ...BASE_INPUT, roleId: OWNER_ROLE_ID });

    expect(summary.roleId).toBe(OWNER_ROLE_ID);
    expect(summary.roleName).toBe("Owner");
    expect(updates).toEqual([{ set: { roleId: OWNER_ROLE_ID } }]);
  });

  it("accepts custom roles belonging to the same organization", async () => {
    const { db } = makeFakeDb({
      ...BASE_SCENARIO,
      role: { id: FOREIGN_ROLE_ID, name: "Deployer", organizationId: ORG_ID },
    });

    const summary = await updateMemberRole(db, { ...BASE_INPUT, roleId: FOREIGN_ROLE_ID });

    expect(summary.roleId).toBe(FOREIGN_ROLE_ID);
    expect(summary.roleName).toBe("Deployer");
  });
});

describe("removeMember", () => {
  it("deletes only the selected membership", async () => {
    const { db, deletions } = makeFakeDb(BASE_SCENARIO);
    await removeMember(db, BASE_INPUT);
    expect(deletions).toHaveLength(1);
    expect(deletions[0]?.table).toBe(memberships);
    const query = new PgDialect().sqlToQuery(deletions[0]!.predicate);
    expect(query.sql).toContain('"memberships"."id"');
    expect(query.params).toEqual(["m-1"]);
  });

  it("rejects missing organizations without deleting", async () => {
    const { db, deletions } = makeFakeDb({ ...BASE_SCENARIO, org: undefined });
    await expectAppError(removeMember(db, BASE_INPUT), 404, "ORGANIZATION_NOT_FOUND");
    expect(deletions).toHaveLength(0);
  });

  it("rejects missing members without deleting", async () => {
    const { db, deletions } = makeFakeDb({ ...BASE_SCENARIO, member: undefined });
    await expectAppError(removeMember(db, BASE_INPUT), 404, "MEMBER_NOT_FOUND");
    expect(deletions).toHaveLength(0);
  });

  it("never removes the organization owner", async () => {
    const { db, deletions } = makeFakeDb({
      ...BASE_SCENARIO,
      member: { id: "m-1", userId: OWNER_USER_ID, joinedAt: JOINED_AT },
    });
    await expectAppError(
      removeMember(db, { ...BASE_INPUT, targetUserId: OWNER_USER_ID }),
      403,
      "OWNER_REMOVE_FORBIDDEN",
    );
    expect(deletions).toHaveLength(0);
  });
});

describe("listMembers", () => {
  it("selects public fields with tenant filtering and stable ordering", async () => {
    const row = {
      userId: MEMBER_USER_ID,
      email: "member@example.com",
      name: "Member",
      roleId: MEMBER_ROLE_ID,
      roleName: "Member",
      joinedAt: JOINED_AT,
    };
    let fields: unknown;
    let predicate: SQL | undefined;
    let ordering: SQL[] = [];
    const chain = {
      innerJoin: () => chain,
      where: (value: SQL) => {
        predicate = value;
        return chain;
      },
      orderBy: async (...values: SQL[]) => {
        ordering = values;
        return [row];
      },
    };
    const db = {
      select: (value: unknown) => {
        fields = value;
        return { from: () => chain };
      },
    } as unknown as Database;
    expect(await listMembers(db, ORG_ID)).toEqual([row]);
    expect(Object.keys(fields as object).toSorted()).toEqual(Object.keys(row).toSorted());
    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(predicate!);
    expect(query.sql).toContain('"memberships"."organization_id"');
    expect(query.params).toEqual([ORG_ID]);
    expect(ordering.map((value) => dialect.sqlToQuery(value).sql)).toEqual([
      '"memberships"."joined_at" asc',
      '"memberships"."user_id" asc',
    ]);
  });
});
