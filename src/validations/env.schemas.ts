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
  })
  .superRefine((values, context) => {
    if (values.JWT_SECRET === values.JWT_REFRESH_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["JWT_REFRESH_SECRET"],
        message: "JWT_REFRESH_SECRET must differ from JWT_SECRET",
      });
    }
  });
