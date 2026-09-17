import type { Request, Response } from "express";

import { describe, expect, it, mock } from "bun:test";

import type { Database } from "../src/database/client.ts";
import { AppError } from "../src/utils/AppError.ts";

const resolveRolePermissions = mock(async (_db: Database, _roleId: string): Promise<string[]> => {
  return grantedPermissions;
});
const grantedPermissions: string[] = [];

mock.module("../src/services/permission.service.ts", () => ({
  resolveRolePermissions,
  invalidateRolePermissionsCache: async () => {},
}));

const { requirePermission } = await import("../src/middleware/requirePermission.ts");

function makeReq(options: { user?: boolean; membership?: boolean } = {}): Request {
  return {
    user: options.user === false ? undefined : { id: "user-1", email: "owner@example.com" },
    membership: options.membership === false ? undefined : { roleId: "role-1", roleName: "Owner" },
  } as unknown as Request;
}

async function run(handler: ReturnType<typeof requirePermission>, req: Request): Promise<unknown> {
  const next = mock((_error?: unknown) => {});
  await handler(req, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]?.[0];
}

describe("requirePermission", () => {
  it("rejects unauthenticated requests with a 401", async () => {
    grantedPermissions.length = 0;
    grantedPermissions.push("role.read");

    const error = (await run(requirePermission("role.read"), makeReq({ user: false }))) as AppError;

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe("UNAUTHORIZED");
  });

  it("rejects requests without a resolved tenant with a 500", async () => {
    const error = (await run(
      requirePermission("role.read"),
      makeReq({ membership: false }),
    )) as AppError;

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(500);
    expect(error.errorCode).toBe("TENANT_CONTEXT_MISSING");
  });

  it("calls next without error when every required permission is granted", async () => {
    grantedPermissions.length = 0;
    grantedPermissions.push("role.read", "role.create");

    const error = await run(requirePermission("role.read", "role.create"), makeReq());

    expect(error).toBeUndefined();
    expect(resolveRolePermissions).toHaveBeenCalledWith(expect.anything(), "role-1");
  });

  it("rejects with 403 listing the missing permissions in request order", async () => {
    grantedPermissions.length = 0;
    grantedPermissions.push("role.read");

    const error = (await run(
      requirePermission("role.delete", "role.read", "role.create"),
      makeReq(),
    )) as AppError;

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe("PERMISSION_DENIED");
    expect(error.message).toBe("Missing required permission(s): role.delete, role.create");
  });
});
