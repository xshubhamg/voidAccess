import { describe, expect, it } from "bun:test";

import { envSchema } from "../src/validations/env.schemas.ts";

const validEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://localhost/test",
  REDIS_URL: "redis://localhost:6379",
  JWT_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  JWT_EXPIRATION: "15m",
  JWT_REFRESH_EXPIRATION: "7d",
};

describe("envSchema", () => {
  it("accepts distinct high-entropy signing secrets", () => {
    expect(envSchema.safeParse(validEnvironment).success).toBe(true);
  });

  it("rejects short signing secrets", () => {
    const result = envSchema.safeParse({
      ...validEnvironment,
      JWT_SECRET: "short",
    });
    expect(result.success).toBe(false);
  });

  it("requires Resend configuration in production", () => {
    const result = envSchema.safeParse({
      ...validEnvironment,
      NODE_ENV: "production",
      APP_URL: "https://app.example.com",
    });
    expect(result.success).toBe(false);
  });

  it("accepts production Resend configuration", () => {
    const result = envSchema.safeParse({
      ...validEnvironment,
      NODE_ENV: "production",
      APP_URL: "https://app.example.com",
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "voidAccess <noreply@example.com>",
      EMAIL_OUTBOX_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    });
    expect(result.success).toBe(true);
  });

  it("rejects insecure production app URLs", () => {
    const result = envSchema.safeParse({
      ...validEnvironment,
      NODE_ENV: "production",
      APP_URL: "http://app.example.com",
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "voidAccess <noreply@example.com>",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsafe cleanup intervals", () => {
    const result = envSchema.safeParse({
      ...validEnvironment,
      RETENTION_CLEANUP_INTERVAL: "0s",
    });
    expect(result.success).toBe(false);
  });

  it("rejects identical signing secrets", () => {
    const result = envSchema.safeParse({
      ...validEnvironment,
      JWT_REFRESH_SECRET: validEnvironment.JWT_SECRET,
    });
    expect(result.success).toBe(false);
  });
});
