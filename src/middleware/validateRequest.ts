import type { NextFunction, Request, RequestHandler, Response } from "express";
import * as z from "zod";

import { AppError } from "../utils/AppError.ts";

const requestParts = ["body", "query", "params"] as const;

type RequestPart = (typeof requestParts)[number];

export type RequestValidationSchemas = Partial<Record<RequestPart, z.ZodType>>;

function formatValidationIssues(part: RequestPart, error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `.${issue.path.join(".")}` : "";
      return `${part}${path}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * Validates the selected parts of an Express request with Zod.
 *
 * Parsed values are written back to the request, so transforms and defaults
 * defined in a schema are available to the route handler.
 */
export function validateRequest(schemas: RequestValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsedValues: Partial<Record<RequestPart, unknown>> = {};
    const validationIssues: string[] = [];

    for (const part of requestParts) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (!result.success) {
        validationIssues.push(formatValidationIssues(part, result.error));
        continue;
      }

      parsedValues[part] = result.data;
    }

    if (validationIssues.length > 0) {
      return next(
        new AppError(
          `Request validation failed: ${validationIssues.join("; ")}`,
          400,
          "VALIDATION_ERROR",
        ),
      );
    }

    for (const part of requestParts) {
      if (Object.hasOwn(parsedValues, part)) {
        Object.defineProperty(req, part, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: parsedValues[part],
        });
      }
    }

    next();
  };
}
