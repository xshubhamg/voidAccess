import { pinoHttp } from "pino-http";

import { logger } from "../utils/logger.ts";
import { randomUUID } from "node:crypto";

export const httpLogger = pinoHttp({
  logger,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.password",
      "req.body.refreshToken",
      "req.body.accessToken",
      "req.body.token",
      "req.body.inviteToken",
      "req.body.passwordConfirmation",
    ],
    censor: "[REDACTED]",
  },
  genReqId: (request, response) => {
    const providedRequestId = request.headers["x-request-id"];
    const requestId =
      typeof providedRequestId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(providedRequestId)
        ? providedRequestId
        : randomUUID();

    response.setHeader("X-Request-Id", requestId);
    return requestId;
  },
  customLogLevel: (_, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },

  serializers: {
    req(req) {
      return {
        ...req,
        id: req.id,
        method: req.method,
        url: req.url?.split("?")[0],
        remoteAddress: req.remoteAddress,
        userAgent: req.headers?.["user-agent"],
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
});
