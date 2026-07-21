import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import pinoHttp from "pino-http";

import { logger } from "./utils/logger.ts";
import { validPort } from "./utils/options.ts";

const PORT = validPort();

const app = express();

app.use(
  pinoHttp({
    logger,
    genReqId: (request, response) => {
      const providedRequestId = request.headers["x-request-id"];
      const requestId =
        typeof providedRequestId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(providedRequestId)
          ? providedRequestId
          : randomUUID();

      response.setHeader("X-Request-Id", requestId);
      return requestId;
    },
  }),
);

app.get("/", (req: Request, res: Response) => {
  req.log.info({ requestId: req.id }, "Handling root request");
  res.send("Hello express | typescript | postgresSQL");
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, "Server is running");
});
