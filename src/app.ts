import express, { type Request, type Response } from "express";

import { rateLimit } from "express-rate-limit";

import { notFoundHandler, errorHandler } from "./middleware/errorHandler.ts";
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

  app.use(httpLogger);

  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );

  app.use("/health", healthRouter);
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
