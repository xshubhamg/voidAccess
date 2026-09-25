import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Request, RequestHandler, Response } from "express";

import { memberRouter } from "../src/routes/member.routes.ts";
import * as auditService from "../src/services/audit.service.ts";
import { authenticate } from "../src/middleware/authenticate.ts";
import { resolveTenant } from "../src/middleware/resolveTenant.ts";
import * as service from "../src/services/membership.service.ts";
import { AppError } from "../src/utils/AppError.ts";

const orgId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const userId = "11111111-2222-4333-8444-555555555555";
const actorId = "99999999-8888-4777-8666-555555555555";
const roleId = "a0000000-0000-4000-8000-000000000001";

type Route = {
  path: string;
  methods: Record<string, boolean>;
  stack: { handle: RequestHandler }[];
};

function route(method: string): Route {
  const layers = memberRouter.stack as { route?: Route }[];
  const found = layers.find((layer) => layer.route?.methods[method])?.route;
  if (!found) throw new Error(`Missing ${method} route`);
  return found;
}

function request(): Request {
  return {
    params: { orgId, userId },
    body: { roleId, actorUserId: "ignored", organizationId: "ignored" },
    organization: { id: orgId },
    user: { id: actorId },
  } as unknown as Request;
}

async function invoke(handler: RequestHandler, req: Request) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    let status = 200;
    const res = {
      status(value: number) {
        status = value;
        return res;
      },
      json(body: unknown) {
        resolve({ status, body });
      },
    } as Response;
    handler(req, res, reject);
  });
}

beforeEach(() => {
  spyOn(auditService, "recordAudit").mockResolvedValue(undefined);
});

afterEach(() => mock.restore());

describe("member routes", () => {
  for (const method of ["get", "patch", "delete"]) {
    it(`${method} authenticates and validates before tenant and permission resolution`, () => {
      const current = route(method);
      expect(current.path).toBe(method === "get" ? "/" : "/:userId");
      expect(current.stack).toHaveLength(5);
      expect(current.stack[0]?.handle).toBe(authenticate);
      expect(current.stack[2]?.handle).toBe(resolveTenant);
      const req = request();
      req.params.orgId = "invalid";
      const next = mock();
      current.stack[1]!.handle(req, {} as Response, next);
      expect(next.mock.calls[0]?.[0]).toBeInstanceOf(AppError);
      expect(next.mock.calls[0]?.[0].errorCode).toBe("VALIDATION_ERROR");
    });
  }

  it("lists members of the resolved organization", async () => {
    const list = spyOn(service, "listMembers").mockResolvedValue([]);
    const result = await invoke(route("get").stack[4]!.handle, request());
    expect(list).toHaveBeenCalledWith(expect.anything(), orgId);
    expect(result).toEqual({
      status: 200,
      body: { success: true, message: "Members retrieved", data: { members: [] } },
    });
  });

  it("updates roles using the authenticated actor and validated body", async () => {
    const member = {
      userId,
      organizationId: orgId,
      roleId,
      roleName: "Member",
      joinedAt: new Date(),
    };
    const update = spyOn(service, "updateMemberRole").mockResolvedValue(member);
    const req = request();
    const next = mock();
    route("patch").stack[1]!.handle(req, {} as Response, next);
    expect(req.body).toEqual({ roleId });
    const result = await invoke(route("patch").stack[4]!.handle, req);
    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: orgId,
        actorUserId: actorId,
        targetUserId: userId,
        roleId,
      }),
    );
    expect(result.status).toBe(200);
  });

  it("removes a member using server-derived context", async () => {
    const remove = spyOn(service, "removeMember").mockResolvedValue(undefined);
    const result = await invoke(route("delete").stack[4]!.handle, request());
    expect(remove).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: orgId,
        actorUserId: actorId,
        targetUserId: userId,
      }),
    );
    expect(result).toEqual({ status: 200, body: { success: true, message: "Member removed" } });
  });

  it("forwards service errors to the global handler", async () => {
    const error = new AppError("Member not found", 404, "MEMBER_NOT_FOUND");
    spyOn(service, "removeMember").mockRejectedValue(error);
    await expect(invoke(route("delete").stack[4]!.handle, request())).rejects.toBe(error);
  });
});
