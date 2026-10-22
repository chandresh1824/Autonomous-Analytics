import { Router } from "express";
import { KPISchema } from "../../schemas/semantic";
import { asyncHandler } from "../asyncHandler";
import { getKpiRepository, resolveConnection } from "../dependencies";
import { HttpError } from "../errorHandler";

export const kpisRouter = Router();

kpisRouter.get(
  "/api/kpis",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getKpiRepository();
    res.json(await repo.list(connection.id));
  })
);

kpisRouter.get(
  "/api/kpis/:kpiId",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getKpiRepository();
    const kpi = await repo.get(connection.id, req.params.kpiId);
    if (!kpi) throw new HttpError(404, "KPI not found");
    res.json(kpi);
  })
);

kpisRouter.post(
  "/api/kpis",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getKpiRepository();
    const payload = KPISchema.parse(req.body);
    let kpi;
    let validation;
    try {
      [kpi, validation] = await repo.create(connection.id, payload);
    } catch (exc) {
      throw new HttpError(409, String((exc as Error).message));
    }
    if (!validation.valid) throw new HttpError(422, validation.errors.join("; "));
    res.status(201).json(kpi);
  })
);

kpisRouter.put(
  "/api/kpis/:kpiId",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getKpiRepository();
    const payload = KPISchema.parse(req.body);
    const [kpi, validation] = await repo.update(connection.id, req.params.kpiId, payload);
    if (!validation.valid) throw new HttpError(422, validation.errors.join("; "));
    res.json(kpi);
  })
);

kpisRouter.delete(
  "/api/kpis/:kpiId",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getKpiRepository();
    await repo.delete(connection.id, req.params.kpiId);
    res.status(204).end();
  })
);

kpisRouter.post(
  "/api/kpis/:kpiId/enable",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getKpiRepository();
    res.json(await repo.setEnabled(connection.id, req.params.kpiId, true));
  })
);

kpisRouter.post(
  "/api/kpis/:kpiId/disable",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getKpiRepository();
    res.json(await repo.setEnabled(connection.id, req.params.kpiId, false));
  })
);

// Publishing lives at the shared `POST /api/semantic-model/publish` endpoint
// now - KPIs are just one part of the same versioned semantic model as
// entities/dimensions/measures/metrics, so there is only ever one publish
// action for all of them (see that route's docstring).
