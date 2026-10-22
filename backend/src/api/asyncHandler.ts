import { NextFunction, Request, RequestHandler, Response } from "express";

/** Wraps an async Express handler so a rejected promise reaches the error
 * middleware, the same way FastAPI's own exception handling always applies
 * regardless of whether a route is sync or async. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
