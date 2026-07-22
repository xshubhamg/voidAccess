import type { ErrorRequestHandler, RequestHandler } from "express";

import { AppError } from "../utils/AppError.ts";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new AppError(`Route ${req.method} ${req.originalUrl} was not found`, 404, "ROUTE_NOT_FOUND"),
  );
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const isAppError = error instanceof AppError;
  const statusCode = isAppError ? error.statusCode : 500;
  const errorCode = isAppError ? error.errorCode : "INTERNAL_SERVER_ERROR";
  const message = isAppError ? error.message : "An unexpected error occurred";

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
