import { randomUUID } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";
import { and, eq, sql } from "drizzle-orm";

import { JWT_REFRESH_EXPIRATION } from "../config/index.ts";
import type { Database } from "../database/client.ts";
import { sessions, users } from "../database/schema/index.ts";
import { AppError } from "../utils/AppError.ts";
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

const REFRESH_TTL_MS = parseDurationMs(JWT_REFRESH_EXPIRATION);

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps driver errors, so walk the cause chain looking for PG's
  // unique_violation code.
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if ((current as { code?: unknown }).code === "23505") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

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
  input: { email: string; password: string; name: string },
): Promise<PublicUser> {
  const passwordHash = await hash(input.password);

  try {
    const [user] = await db
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

    return user;
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
): Promise<AuthResult> {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${input.email}`)
    .limit(1);

  if (!user || !(await verify(user.passwordHash, input.password))) {
    throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
  }

  return createSessionForUser(db, toPublicUser(user), meta);
}

async function createSessionForUser(
  db: Database,
  user: PublicUser,
  meta: SessionMeta,
): Promise<AuthResult> {
  const sessionId = randomUUID();
  const refreshToken = signRefreshToken(user.id, sessionId);

  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    refreshTokenHash: hashToken(refreshToken),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });

  return { user, accessToken: signAccessToken(user.id), refreshToken };
}

export async function refreshSession(db: Database, refreshToken: string): Promise<AuthResult> {
  const payload = verifyRefreshToken(refreshToken);
  const tokenHash = hashToken(refreshToken);

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.refreshTokenHash, tokenHash))
    .limit(1);

  if (!session || session.id !== payload.sid || session.userId !== payload.sub) {
    throw new AppError("Refresh token is invalid", 401, "INVALID_REFRESH_TOKEN");
  }

  if (session.status !== "active") {
    // Token replay: this session was already rotated or revoked. Fail closed.
    await db
      .update(sessions)
      .set({ status: "revoked" })
      .where(and(eq(sessions.userId, session.userId), eq(sessions.status, "active")));

    throw new AppError(
      "Refresh token was already used — all sessions have been revoked",
      401,
      "TOKEN_REUSE_DETECTED",
    );
  }

  const now = new Date();
  if (session.expiresAt <= now) {
    await db.update(sessions).set({ status: "expired" }).where(eq(sessions.id, session.id));

    throw new AppError("Session has expired", 401, "SESSION_EXPIRED");
  }

  const [user] = await db
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
  await db
    .update(sessions)
    .set({ refreshTokenHash: hashToken(nextRefreshToken), lastUsedAt: now })
    .where(eq(sessions.id, session.id));

  return {
    user: toPublicUser(user),
    accessToken: signAccessToken(session.userId),
    refreshToken: nextRefreshToken,
  };
}

export async function logoutSession(db: Database, refreshToken: string): Promise<void> {
  const payload = verifyRefreshToken(refreshToken);
  const tokenHash = hashToken(refreshToken);

  await db
    .update(sessions)
    .set({ status: "revoked" })
    .where(
      and(
        eq(sessions.refreshTokenHash, tokenHash),
        eq(sessions.id, payload.sid),
        eq(sessions.status, "active"),
      ),
    );
}

export async function revokeAllSessions(db: Database, userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ status: "revoked" })
    .where(and(eq(sessions.userId, userId), eq(sessions.status, "active")));
}
