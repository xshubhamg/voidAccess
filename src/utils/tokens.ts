import { createHash, randomUUID } from "node:crypto";

import jwt from "jsonwebtoken";

import {
  JWT_EXPIRATION,
  JWT_REFRESH_EXPIRATION,
  JWT_REFRESH_SECRET,
  JWT_SECRET,
} from "../config/index.ts";
import { AppError } from "./AppError.ts";

export interface AccessTokenPayload {
  sub: string;
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
}

const durationUnits: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDurationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());

  if (!match) {
    throw new Error(`Invalid duration "${value}" — expected forms like "30s", "15m", "12h", "7d"`);
  }

  const unitMs = match[2] !== undefined ? durationUnits[match[2]] : undefined;
  if (match[1] === undefined || unitMs === undefined) {
    throw new Error(`Invalid duration "${value}"`);
  }

  const amount = Number(match[1]);
  return amount * unitMs;
}

const ACCESS_TOKEN_TTL_SECONDS = parseDurationMs(JWT_EXPIRATION) / 1000;
const REFRESH_TOKEN_TTL_SECONDS = parseDurationMs(JWT_REFRESH_EXPIRATION) / 1000;

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
}

export function signRefreshToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId, jti: randomUUID() }, JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const payload = jwt.verify(token, JWT_SECRET);

    if (typeof payload === "string") {
      throw new Error("Unexpected token payload");
    }

    const userId = payload.sub;
    if (typeof userId !== "string" || userId.length === 0) {
      throw new Error("Missing subject claim");
    }

    return { sub: userId };
  } catch {
    throw new AppError("Access token is invalid or expired", 401, "INVALID_ACCESS_TOKEN");
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const payload = jwt.verify(token, JWT_REFRESH_SECRET);

    if (typeof payload === "string") {
      throw new Error("Unexpected token payload");
    }

    const { sub, sid } = payload as { sub?: unknown; sid?: unknown };
    if (
      typeof sub !== "string" ||
      typeof sid !== "string" ||
      sub.length === 0 ||
      sid.length === 0
    ) {
      throw new Error("Missing subject or session claims");
    }

    return { sub, sid };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Refresh token is invalid or expired", 401, "INVALID_REFRESH_TOKEN");
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
