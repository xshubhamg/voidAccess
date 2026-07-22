import express, { type Request, type Response } from "express";

import { rateLimit } from "express-rate-limit";

import { notFoundHandler, errorHandler } from "./middleware/errorHandler.ts";
import { logger } from "./utils/logger.ts";
import { validPort } from "./utils/options.ts";
import { httpLogger } from "./middleware/httpLogger.ts";

const PORT = validPort();

const app = express();

app.use(httpLogger);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);

app.get("/", (req: Request, res: Response) => {
  req.log.info({ requestId: req.id }, "Handling root request");
  res.send("Hello express | typescript | postgresSQL");
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info({ port: PORT }, "Server is running");
});
