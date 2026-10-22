import { Router } from "express";
import { AppError } from "../../core/exceptions";
import { MetricSchema } from "../../schemas/semantic";
import { asyncHandler } from "../asyncHandler";
import { getMetricRepository, resolveConnection } from "../dependencies";
import { HttpError } from "../errorHandler";

export const metricsRouter = Router();

metricsRouter.get(
  "/api/metrics",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getMetricRepository();
    res.json(await repo.list(connection.id));
  })
);

metricsRouter.get(
  "/api/metrics/:metricId",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getMetricRepository();
    const metric = await repo.get(connection.id, req.params.metricId);
    if (!metric) throw new HttpError(404, "Metric not found");
    res.json(metric);
  })
);

metricsRouter.post(
  "/api/metrics",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getMetricRepository();
    const payload = MetricSchema.parse(req.body);
    let metric;
    let validation;
    try {
      [metric, validation] = await repo.create(connection.id, payload);
    } catch (exc) {
      throw new HttpError(409, String((exc as Error).message));
    }
    if (!validation.valid) throw new HttpError(422, validation.errors.join("; "));
    res.status(201).json(metric);
  })
);

metricsRouter.put(
  "/api/metrics/:metricId",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getMetricRepository();
    const payload = MetricSchema.parse(req.body);
    const [metric, validation] = await repo.update(connection.id, req.params.metricId, payload);
    if (!validation.valid) throw new HttpError(422, validation.errors.join("; "));
    res.json(metric);
  })
);

metricsRouter.delete(
  "/api/metrics/:metricId",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getMetricRepository();
    try {
      await repo.delete(connection.id, req.params.metricId);
    } catch (exc) {
      if (exc instanceof AppError) throw exc; // e.g. NotFoundError - keep its own 404 status
      throw new HttpError(409, String((exc as Error).message));
    }
    res.status(204).end();
  })
);
