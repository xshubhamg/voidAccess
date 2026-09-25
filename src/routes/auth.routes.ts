import { Router } from "express";
import { rateLimit } from "express-rate-limit";

import { NODE_ENV } from "../config/index.ts";
import { createRateLimitStore } from "../middleware/rateLimitStore.ts";
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
import {
  requestEmailVerification,
  verifyEmailToken,
} from "../services/email-verification.service.ts";
import { AppError } from "../utils/AppError.ts";
import { requestAuditContext } from "../utils/auditContext.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import {
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resendVerificationSchema,
  verificationTokenSchema,
} from "../validations/auth.schemas.ts";

function sessionMetaFrom(ip: string | undefined, userAgent: string | undefined): SessionMeta {
  return { ipAddress: ip ?? null, userAgent: userAgent ?? null };
}

export const authRouter: Router = Router();

authRouter.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: createRateLimitStore("auth", 15 * 60 * 1000),
  }),
);

authRouter.post(
  "/register",
  validateRequest({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const { user, verificationToken } = await registerUser(db, {
      ...req.body,
      audit: (createdUser) => ({
        ...requestAuditContext(req),
        organizationId: null,
        actorId: createdUser.id,
        action: "auth.registered",
        resourceType: "user",
        resourceId: createdUser.id,
      }),
    });

    res.status(201).json({
      success: true,
      message: "Account created",
      data: {
        user,
        ...(NODE_ENV === "production" ? {} : { verificationToken }),
      },
    });
  }),
);

authRouter.post(
  "/verify-email",
  validateRequest({ body: verificationTokenSchema }),
  asyncHandler(async (req, res) => {
    await verifyEmailToken(db, req.body.token, {
      ...requestAuditContext(req),
      organizationId: null,
      actorId: null,
      action: "auth.email_verified",
      resourceType: "user",
    });

    res.status(200).json({
      success: true,
      message: "Email verified",
    });
  }),
);

authRouter.post(
  "/resend-verification",
  validateRequest({ body: resendVerificationSchema }),
  asyncHandler(async (req, res) => {
    const verificationToken = await requestEmailVerification(db, req.body.email, {
      ...requestAuditContext(req),
      organizationId: null,
      actorId: null,
      action: "auth.verification_requested",
      resourceType: "user",
    });

    res.status(202).json({
      success: true,
      message: "If the account exists and is unverified, a verification message was sent",
      data: NODE_ENV === "production" || !verificationToken ? {} : { verificationToken },
    });
  }),
);

authRouter.post(
  "/login",
  validateRequest({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const meta = sessionMetaFrom(req.ip, req.headers["user-agent"]);
    const result = await loginUser(db, req.body, meta, (user) => ({
      ...requestAuditContext(req),
      organizationId: null,
      actorId: user.id,
      action: "auth.login",
      resourceType: "user",
      resourceId: user.id,
    }));

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
    const result = await refreshSession(db, req.body.refreshToken, (user) => ({
      ...requestAuditContext(req),
      organizationId: null,
      actorId: user.id,
      action: "auth.session_refreshed",
      resourceType: "user",
      resourceId: user.id,
    }));

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
    await logoutSession(db, req.body.refreshToken, {
      ...requestAuditContext(req),
      organizationId: null,
      actorId: null,
      action: "auth.logout",
      resourceType: "session",
    });

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

    await revokeAllSessions(db, req.user.id, {
      ...requestAuditContext(req),
      organizationId: null,
      actorId: req.user.id,
      action: "auth.logout_all",
      resourceType: "session",
    });

    res.status(200).json({
      success: true,
      message: "Logged out of all sessions",
    });
  }),
);
