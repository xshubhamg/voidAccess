import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Request, RequestHandler, Response } from "express";

import { roleRouter } from "../src/routes/role.routes.ts";
import * as service from "../src/services/role.service.ts";

const organizationId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const userId = "11111111-2222-4333-8444-555555555555";

type Route = {
  path: string;
  methods: Record<string, boolean>;
  stack: { handle: RequestHandler }[];
};

function route(): Route {
  const layers = roleRouter.stack as { route?: Route }[];
  const found = layers.find((layer) => layer.route?.methods.get)?.route;
  if (!found) throw new Error("Missing role list route");
  return found;
}

function request(): Request {
  return {
    params: { orgId: organizationId },
    query: { page: 2, limit: 10 },
    organization: { id: organizationId },
    user: { id: userId },
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

afterEach(() => mock.restore());

describe("role list route", () => {
  it("returns paginated roles using validated query values", async () => {
    const list = spyOn(service, "listOrganizationRoles").mockResolvedValue({
      items: [],
      page: 2,
      limit: 10,
      total: 0,
    });

    const result = await invoke(route().stack[4]!.handle, request());

    expect(list).toHaveBeenCalledWith(expect.anything(), organizationId, { page: 2, limit: 10 });
    expect(result).toEqual({
      status: 200,
      body: {
        success: true,
        message: "Roles retrieved",
        data: { items: [], page: 2, limit: 10, total: 0 },
      },
    });
  });
});
