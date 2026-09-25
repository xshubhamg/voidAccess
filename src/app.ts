import express, { type Request, type Response } from "express";

import { rateLimit } from "express-rate-limit";

import { notFoundHandler, errorHandler } from "./middleware/errorHandler.ts";
import { createRateLimitStore } from "./middleware/rateLimitStore.ts";
import { TRUST_PROXY_HOPS } from "./config/index.ts";
import { httpLogger } from "./middleware/httpLogger.ts";
import { authRouter } from "./routes/auth.routes.ts";
import { auditRouter } from "./routes/audit.routes.ts";
import { healthRouter } from "./routes/health.routes.ts";
import { inviteRouter } from "./routes/invite.routes.ts";
import { memberRouter } from "./routes/member.routes.ts";
import { organizationRouter } from "./routes/organization.routes.ts";
import { roleRouter } from "./routes/role.routes.ts";

export function buildApp(): express.Express {
  const app = express();

  app.set("trust proxy", TRUST_PROXY_HOPS);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.use(httpLogger);

  app.use("/health", healthRouter);

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      store: createRateLimitStore("global", 15 * 60 * 1000),
    }),
  );

  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));

  app.use("/auth", authRouter);
  app.use("/organizations", organizationRouter);
  app.use("/organizations/:orgId/roles", roleRouter);
  app.use("/organizations/:orgId/members", memberRouter);
  app.use("/", auditRouter);
  app.use("/", inviteRouter);

  app.get("/", (req: Request, res: Response) => {
    req.log.info({ requestId: req.id }, "Handling root request");
    res.send("Hello express | typescript | postgresSQL");
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
