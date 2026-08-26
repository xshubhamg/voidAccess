import { Router } from "express";

import { db } from "../database/client.ts";
import { authenticate } from "../middleware/authenticate.ts";
import { validateRequest } from "../middleware/validateRequest.ts";
import {
  loginUser,
  logoutSession,
  refreshSession,
  registerUser,
  revokeAllSessions,
  type SessionMeta,
} from "../services/auth.service.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { loginSchema, refreshTokenSchema, registerSchema } from "../validations/auth.schemas.ts";

function sessionMetaFrom(ip: string | undefined, userAgent: string | undefined): SessionMeta {
  return { ipAddress: ip ?? null, userAgent: userAgent ?? null };
}

export const authRouter: Router = Router();

authRouter.post(
  "/register",
  validateRequest({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const user = await registerUser(db, req.body);

    res.status(201).json({
      success: true,
      message: "Account created",
      data: { user },
    });
  }),
);

authRouter.post(
  "/login",
  validateRequest({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const meta = sessionMetaFrom(req.ip, req.headers["user-agent"]);
    const result = await loginUser(db, req.body, meta);

    res.status(200).json({
      success: true,
      message: "Logged in",
      data: result,
    });
  }),
);

authRouter.post(
  "/refresh",
  validateRequest({ body: refreshTokenSchema }),
  asyncHandler(async (req, res) => {
    const result = await refreshSession(db, req.body.refreshToken);

    res.status(200).json({
      success: true,
      message: "Session refreshed",
      data: result,
    });
  }),
);

authRouter.post(
  "/logout",
  validateRequest({ body: refreshTokenSchema }),
  asyncHandler(async (req, res) => {
    await logoutSession(db, req.body.refreshToken);

    res.status(200).json({
      success: true,
      message: "Logged out",
    });
  }),
);

authRouter.post(
  "/logout-all",
  authenticate,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError("Authentication required", 401, "UNAUTHORIZED");
    }

    await revokeAllSessions(db, req.user.id);

    res.status(200).json({
      success: true,
      message: "Logged out of all sessions",
    });
  }),
);
