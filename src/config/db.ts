import dotenv from "dotenv";

import { dbEnvSchema } from "../validations/env.schemas.ts";

dotenv.config();

const parsedDbEnv = dbEnvSchema.safeParse(process.env);

if (!parsedDbEnv.success) {
  const issues = parsedDbEnv.error.issues
    .map(({ path, message }) => `${path.join(".") || "database"}: ${message}`)
    .join(", ");

  throw new Error(`Invalid database configuration: ${issues}`);
}

export const dbConfig = parsedDbEnv.data;
export const { DATABASE_URL } = dbConfig;
