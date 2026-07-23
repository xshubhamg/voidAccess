import { config } from "../config/index.ts";
import pino from "pino";

const isDevelopment = config.NODE_ENV !== "production";

export const logger = pino({
  level: config.LOG_LEVEL ?? (isDevelopment ? "debug" : "info"),
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
        },
      }
    : undefined,
});
