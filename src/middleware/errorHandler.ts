import type { ErrorRequestHandler, RequestHandler, Request, Response } from "express";

import { AppError } from "../utils/AppError.ts";

export const notFoundHandler: RequestHandler = (req: Request, _res: Response, next) => {
  next(new AppError(`Route ${req.method} ${req.path} was not found`, 404, "ROUTE_NOT_FOUND"));
};

export const errorHandler: ErrorRequestHandler = (error, req: Request, res: Response, _next) => {
  const isAppError = error instanceof AppError;
  const errorStatus = error.statusCode ?? error.status;
  const isClientError = !isAppError && errorStatus >= 400 && errorStatus < 500;
  const statusCode = isAppError ? error.statusCode : isClientError ? errorStatus : 500;
  const errorCode = isAppError ? error.errorCode : "INTERNAL_SERVER_ERROR";
  const message = isAppError
    ? error.message
    : isClientError
      ? "A client error occurred"
      : "An unexpected error occurred";

  req.log.error(
    {
      err: error,
      requestId: req.id,
      statusCode,
      errorCode,
    },
    "Request failed",
  );

  res.status(statusCode).json({
    success: false,
    message,
    error: { code: errorCode },
  });
};
