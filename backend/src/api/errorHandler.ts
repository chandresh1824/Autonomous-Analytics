import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../core/exceptions";
import { getLogger } from "../core/logging";

const logger = getLogger("api.errorHandler");

/** Simple HTTP error carrying a status code, for routes that need a plain
 * 404/400/409/422 without a dedicated `AppError` subclass - mirrors
 * FastAPI's `HTTPException`. */
export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/** Matches FastAPI's default error body shape (`{"detail": "..."}`) so the
 * existing frontend's `getApiErrorMessage` keeps working unchanged. */
export function errorHandlerMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    logger.warning("app_error", { path: req.originalUrl, error: err.message });
    res.status(err.statusCode).json({ detail: err.message });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ detail: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({ detail: err.errors.map((e) => ({ msg: e.message, loc: e.path })) });
    return;
  }
  logger.exception("unhandled_error", { path: req.originalUrl, error: String((err as Error)?.message ?? err) });
  res.status(500).json({ detail: "Internal server error" });
}
