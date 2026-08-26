import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";

import { db } from "../database/client.ts";
import { users } from "../database/schema/index.ts";
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
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, payload.sub))
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
