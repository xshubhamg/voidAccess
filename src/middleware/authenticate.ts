import type { RequestHandler } from "express";
import { and, eq, gt } from "drizzle-orm";

import { db } from "../database/client.ts";
import { sessions, users } from "../database/schema/index.ts";
import { AppError } from "../utils/AppError.ts";
import { verifyAccessToken } from "../utils/tokens.ts";

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      throw new AppError("Missing bearer token", 401, "MISSING_ACCESS_TOKEN");
    }

    const payload = verifyAccessToken(header.slice("Bearer ".length));

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .innerJoin(sessions, eq(sessions.userId, users.id))
      .where(
        and(
          eq(users.id, payload.sub),
          eq(sessions.id, payload.sid),
          eq(sessions.status, "active"),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!user) {
      throw new AppError("Access token is invalid", 401, "INVALID_ACCESS_TOKEN");
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};
