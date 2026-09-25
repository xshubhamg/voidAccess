import { randomUUID } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";
import { and, eq, sql } from "drizzle-orm";

import { JWT_REFRESH_EXPIRATION } from "../config/index.ts";
import type { Database, DatabaseExecutor } from "../database/client.ts";
import { sessions, users } from "../database/schema/index.ts";
import { recordAudit, type AuditEvent } from "./audit.service.ts";
import { issueEmailVerificationToken } from "./email-verification.service.ts";
import { enqueueVerificationEmail } from "./email-delivery.service.ts";
import { AppError } from "../utils/AppError.ts";
import { isUniqueViolation } from "../utils/dbErrors.ts";
import {
  hashToken,
  parseDurationMs,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../utils/tokens.ts";

export interface SessionMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

interface PublicUser extends AuthUser {
  emailVerified: boolean;
  createdAt: Date;
}

interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

interface RegistrationResult {
  user: PublicUser;
  verificationToken: string;
}

const REFRESH_TTL_MS = parseDurationMs(JWT_REFRESH_EXPIRATION);

function toPublicUser(row: {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: Date;
}): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt,
  };
}

export async function registerUser(
  db: Database,
  input: {
    email: string;
    password: string;
    name: string;
    audit?: (user: PublicUser) => AuditEvent;
  },
): Promise<RegistrationResult> {
  const passwordHash = await hash(input.password);

  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          name: input.name,
        })
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          emailVerified: users.emailVerified,
          createdAt: users.createdAt,
        });

      if (!user) {
        throw new AppError("Failed to create account", 500, "REGISTRATION_FAILED");
      }

      if (input.audit) {
        await recordAudit(tx, input.audit(user));
      }

      const verificationToken = await issueEmailVerificationToken(tx, user.id);
      await enqueueVerificationEmail(tx, {
        to: user.email,
        token: verificationToken,
        userId: user.id,
      });
      return { user, verificationToken };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("An account with this email already exists", 409, "EMAIL_ALREADY_EXISTS");
    }
    throw error;
  }
}

export async function loginUser(
  db: Database,
  input: { email: string; password: string },
  meta: SessionMeta,
  audit?: (user: PublicUser) => AuditEvent,
): Promise<AuthResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`)
      .limit(1);

    if (!user || !(await verify(user.passwordHash, input.password))) {
      throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
    }

    if (!user.emailVerified) {
      throw new AppError("Email verification is required", 403, "EMAIL_NOT_VERIFIED");
    }

    return createSessionForUser(tx, toPublicUser(user), meta, audit);
  });
}

async function createSessionForUser(
  db: DatabaseExecutor,
  user: PublicUser,
  meta: SessionMeta,
  audit?: (user: PublicUser) => AuditEvent,
): Promise<AuthResult> {
  const sessionId = randomUUID();
  const refreshToken = signRefreshToken(user.id, sessionId);

  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    refreshTokenHash: hashToken(refreshToken),
    refreshTokenJti: verifyRefreshToken(refreshToken).jti,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });

  if (audit) {
    await recordAudit(db, audit(user));
  }

  return { user, accessToken: signAccessToken(user.id, sessionId), refreshToken };
}

export async function refreshSession(
  db: Database,
  refreshToken: string,
  audit?: (user: PublicUser) => AuditEvent,
): Promise<AuthResult> {
  const payload = verifyRefreshToken(refreshToken);
  const tokenHash = hashToken(refreshToken);
  const now = new Date();

  const outcome = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, payload.sid), eq(sessions.userId, payload.sub)))
      .for("update")
      .limit(1);

    if (!session) {
      throw new AppError("Refresh token is invalid", 401, "INVALID_REFRESH_TOKEN");
    }

    const tokenMatchesCurrentSession = session.refreshTokenJti
      ? session.refreshTokenJti === payload.jti
      : session.refreshTokenHash === tokenHash;

    if (!tokenMatchesCurrentSession) {
      await tx
        .update(sessions)
        .set({ status: "revoked" })
        .where(and(eq(sessions.userId, session.userId), eq(sessions.status, "active")));
      return { kind: "reuse" as const };
    }

    if (session.status !== "active") {
      await tx
        .update(sessions)
        .set({ status: "revoked" })
        .where(and(eq(sessions.userId, session.userId), eq(sessions.status, "active")));
      return { kind: "reuse" as const };
    }

    if (session.expiresAt <= now) {
      await tx.update(sessions).set({ status: "expired" }).where(eq(sessions.id, session.id));
      return { kind: "expired" as const };
    }

    const [user] = await tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) {
      throw new AppError("Refresh token is invalid", 401, "INVALID_REFRESH_TOKEN");
    }

    const nextRefreshToken = signRefreshToken(session.userId, session.id);
    const [rotated] = await tx
      .update(sessions)
      .set({
        refreshTokenHash: hashToken(nextRefreshToken),
        refreshTokenJti: verifyRefreshToken(nextRefreshToken).jti,
        lastUsedAt: now,
      })
      .where(
        and(
          eq(sessions.id, session.id),
          eq(sessions.status, "active"),
          eq(sessions.refreshTokenHash, tokenHash),
        ),
      )
      .returning({ id: sessions.id });

    if (!rotated) {
      await tx
        .update(sessions)
        .set({ status: "revoked" })
        .where(and(eq(sessions.userId, session.userId), eq(sessions.status, "active")));
      return { kind: "reuse" as const };
    }

    if (audit) {
      await recordAudit(tx, audit(toPublicUser(user)));
    }

    return {
      kind: "success" as const,
      result: {
        user: toPublicUser(user),
        accessToken: signAccessToken(session.userId, session.id),
        refreshToken: nextRefreshToken,
      },
    };
  });

  if (outcome.kind === "reuse") {
    throw new AppError(
      "Refresh token was already used — all sessions have been revoked",
      401,
      "TOKEN_REUSE_DETECTED",
    );
  }

  if (outcome.kind === "expired") {
    throw new AppError("Session has expired", 401, "SESSION_EXPIRED");
  }

  return outcome.result;
}

export async function logoutSession(
  db: Database,
  refreshToken: string,
  audit?: AuditEvent,
): Promise<void> {
  const payload = verifyRefreshToken(refreshToken);
  const tokenHash = hashToken(refreshToken);

  await db.transaction(async (tx) => {
    const [revoked] = await tx
      .update(sessions)
      .set({ status: "revoked" })
      .where(
        and(
          eq(sessions.refreshTokenHash, tokenHash),
          eq(sessions.id, payload.sid),
          eq(sessions.status, "active"),
        ),
      )
      .returning({ id: sessions.id });

    if (revoked && audit) {
      await recordAudit(tx, audit);
    }
  });
}

export async function revokeAllSessions(
  db: Database,
  userId: string,
  audit?: AuditEvent,
): Promise<void> {
  await db.transaction(async (tx) => {
    const revoked = await tx
      .update(sessions)
      .set({ status: "revoked" })
      .where(and(eq(sessions.userId, userId), eq(sessions.status, "active")))
      .returning({ id: sessions.id });

    if (revoked.length > 0 && audit) {
      await recordAudit(tx, audit);
    }
  });
}
