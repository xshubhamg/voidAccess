import dotenv from "dotenv";

import { z } from "zod";
import { envSchema } from "../validations/env.schemas.ts";

dotenv.config();

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues
    .map(({ path, message }) => `${path.join(".") || "environment"}: ${message}`)
    .join(", ");

  throw new Error(`Invalid environment configuration: ${issues}`);
}

export type Config = z.infer<typeof envSchema>;

export const config: Config = parsedEnv.data;
export const env = config;

export const {
  NODE_ENV,
  PORT,
  LOG_LEVEL,
  DATABASE_URL,
  REDIS_URL,
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  JWT_EXPIRATION,
  JWT_REFRESH_EXPIRATION,
  EMAIL_VERIFICATION_EXPIRATION,
} = config;
