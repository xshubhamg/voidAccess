import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Drizzle");
}

export default defineConfig({
  out: "./drizzle",
  schema: "./src/database/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
