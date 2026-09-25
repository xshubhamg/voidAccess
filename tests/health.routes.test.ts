import { describe, expect, it } from "bun:test";
import type { Request, RequestHandler, Response } from "express";

import {
  buildHealthRouter,
  getReadinessStatus,
  type ReadinessResult,
} from "../src/routes/health.routes.ts";

type Route = {
  path: string;
  methods: Record<string, boolean>;
  stack: { handle: RequestHandler }[];
};

function route(router: ReturnType<typeof buildHealthRouter>, path: string): Route {
  const layers = router.stack as { route?: Route }[];
  const found = layers.find((layer) => layer.route?.path === path)?.route;
  if (!found) throw new Error(`Missing route ${path}`);
  return found;
}

async function invoke(
  handler: RequestHandler,
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  return new Promise((resolve) => {
    let status = 200;
    const headers: Record<string, string> = {};
    const res = {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      status(value: number) {
        status = value;
        return res;
      },
      json(body: unknown) {
        resolve({ status, body, headers });
      },
    } as unknown as Response;
    handler({} as Request, res, () => undefined);
  });
}

describe("readiness checks", () => {
  it("reports both dependencies healthy", async () => {
    await expect(
      getReadinessStatus(
        {
          postgres: async () => undefined,
          redis: async () => "PONG",
        },
        100,
      ),
    ).resolves.toEqual({ postgres: "up", redis: "up" });
  });

  it("marks a failed dependency down", async () => {
    await expect(
      getReadinessStatus(
        {
          postgres: async () => undefined,
          redis: async () => {
            throw new Error("redis unavailable");
          },
        },
        100,
      ),
    ).resolves.toEqual({ postgres: "up", redis: "down" });
  });

  it("marks a timed out dependency down", async () => {
    await expect(
      getReadinessStatus(
        {
          postgres: () => new Promise(() => undefined),
          redis: async () => "PONG",
        },
        10,
      ),
    ).resolves.toEqual({ postgres: "down", redis: "up" });
  });
});

describe("health routes", () => {
  it("returns liveness without dependency checks", async () => {
    const router = buildHealthRouter(async () => ({ postgres: "down", redis: "down" }));
    const result = await invoke(route(router, "/").stack[0]!.handle);

    expect(result.status).toBe(200);
    expect(result.headers["Cache-Control"]).toBe("no-store");
    expect(result.body).toMatchObject({ status: "ok" });
  });

  it("maps ready dependencies to 200", async () => {
    const router = buildHealthRouter(
      async (): Promise<ReadinessResult> => ({ postgres: "up", redis: "up" }),
    );
    const result = await invoke(route(router, "/ready").stack[0]!.handle);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      status: "ready",
      dependencies: { postgres: "up", redis: "up" },
    });
  });

  it("maps failed dependencies to 503", async () => {
    const router = buildHealthRouter(
      async (): Promise<ReadinessResult> => ({ postgres: "up", redis: "down" }),
    );
    const result = await invoke(route(router, "/ready").stack[0]!.handle);

    expect(result.status).toBe(503);
    expect(result.body).toEqual({
      status: "not_ready",
      dependencies: { postgres: "up", redis: "down" },
    });
  });
});
