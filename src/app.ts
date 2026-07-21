import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import pinoHttp from "pino-http";

import { logger } from "./utils/logger.ts";

const PORT = Number(process.env.PORT) || 3000;

const app = express();

app.use(
  pinoHttp({
    logger,
    genReqId: (request, response) => {
      const providedRequestId = request.headers["x-request-id"];
      const requestId =
        typeof providedRequestId === "string" && providedRequestId.length <= 128
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
