import z from "zod";

const databaseUrl = z.string().min(1, "DATABASE_URL is required");

export const dbEnvSchema = z.object({
  DATABASE_URL: databaseUrl,
});

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
    DATABASE_URL: databaseUrl,
    REDIS_URL: z.string().min(1, "REDIS_URL is required"),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
    JWT_EXPIRATION: z.string().min(1, "JWT_EXPIRATION is required"),
    JWT_REFRESH_EXPIRATION: z.string().min(1, "JWT_REFRESH_EXPIRATION is required"),
    EMAIL_VERIFICATION_EXPIRATION: z
      .string()
      .min(1, "EMAIL_VERIFICATION_EXPIRATION is required")
      .default("24h"),
    INVITE_EXPIRATION: z.string().min(1, "INVITE_EXPIRATION is required").default("7d"),
    APP_URL: z.string().url("APP_URL must be a valid URL").default("http://localhost:3000"),
    RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY must not be empty").optional(),
    EMAIL_FROM: z.string().min(1, "EMAIL_FROM must not be empty").optional(),
    EMAIL_OUTBOX_ENCRYPTION_KEY: z
      .string()
      .min(1, "EMAIL_OUTBOX_ENCRYPTION_KEY is required")
      .optional(),
    RETENTION_TERMINAL_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    RETENTION_AUDIT_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
    RETENTION_CLEANUP_INTERVAL: z
      .string()
      .regex(/^\d+[smhd]$/, "RETENTION_CLEANUP_INTERVAL must be a duration")
      .default("1h"),
  })
  .superRefine((values, context) => {
    if (
      values.EMAIL_OUTBOX_ENCRYPTION_KEY &&
      Buffer.from(values.EMAIL_OUTBOX_ENCRYPTION_KEY, "base64").length !== 32
    ) {
      context.addIssue({
        code: "custom",
        path: ["EMAIL_OUTBOX_ENCRYPTION_KEY"],
        message: "EMAIL_OUTBOX_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
      });
    }

    if (
      values.NODE_ENV === "production" &&
      (!values.RESEND_API_KEY || !values.EMAIL_FROM || !values.EMAIL_OUTBOX_ENCRYPTION_KEY)
    ) {
      context.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "RESEND_API_KEY and EMAIL_FROM are required in production",
      });
    }

    if (values.NODE_ENV === "production" && !values.APP_URL.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "APP_URL must use HTTPS in production",
      });
    }

    const cleanupMatch = /^(\d+)([smhd])$/.exec(values.RETENTION_CLEANUP_INTERVAL);
    if (cleanupMatch) {
      const unitMs =
        cleanupMatch[2] === "s"
          ? 1_000
          : cleanupMatch[2] === "m"
            ? 60_000
            : cleanupMatch[2] === "h"
              ? 3_600_000
              : 86_400_000;
      const intervalMs = Number(cleanupMatch[1]) * unitMs;
      if (intervalMs < 60_000 || intervalMs > 86_400_000) {
        context.addIssue({
          code: "custom",
          path: ["RETENTION_CLEANUP_INTERVAL"],
          message: "RETENTION_CLEANUP_INTERVAL must be between 1m and 24h",
        });
      }
    }

    if (values.JWT_SECRET === values.JWT_REFRESH_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["JWT_REFRESH_SECRET"],
        message: "JWT_REFRESH_SECRET must differ from JWT_SECRET",
      });
    }
  });
