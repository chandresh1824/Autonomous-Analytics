import { Router } from "express";
import { asyncHandler } from "../asyncHandler";
import { getConnectionRepository, getDatasourceRegistry, getRagAgentDep, getSemanticRepository } from "../dependencies";
import { HttpError } from "../errorHandler";
import { ConnectionCreateSchema, ConnectionTestSchema, ConnectionUpdateSchema } from "../../schemas/connection";
import { createDataSource } from "../../services/datasource/factory";
import { decryptConnectionPassword } from "../../services/datasource/registry";

export const connectionsRouter = Router();

connectionsRouter.get(
  "/api/connections",
  asyncHandler(async (_req, res) => {
    const repo = getConnectionRepository();
    res.json(await repo.list());
  })
);

connectionsRouter.post(
  "/api/connections",
  asyncHandler(async (req, res) => {
    const payload = ConnectionCreateSchema.parse(req.body);
    const repo = getConnectionRepository();
    res.status(201).json(await repo.create(payload));
  })
);

/** Test connection settings before they are saved. */
connectionsRouter.post(
  "/api/connections/test",
  asyncHandler(async (req, res) => {
    const payload = ConnectionTestSchema.parse(req.body);
    let password = payload.password || null;
    if (!password && payload.connection_id) {
      const saved = await getConnectionRepository().getModel(payload.connection_id);
      if (!saved) throw new HttpError(404, "Connection not found");
      password = decryptConnectionPassword(saved);
    }
    const datasource = createDataSource({
      type: payload.type,
      name: payload.name,
      host: payload.host,
      port: payload.port,
      database: payload.database,
      username: payload.username,
      password,
      ssl: payload.ssl,
    });
    try {
      const [success, message] = await datasource.testConnection();
      res.json({ success, message });
    } finally {
      await datasource.close();
    }
  })
);

connectionsRouter.put(
  "/api/connections/:connectionId",
  asyncHandler(async (req, res) => {
    const payload = ConnectionUpdateSchema.parse(req.body);
    const repo = getConnectionRepository();
    const updated = await repo.update(req.params.connectionId, payload);
    if (!updated) throw new HttpError(404, "Connection not found");
    res.json(updated);
  })
);

connectionsRouter.delete(
  "/api/connections/:connectionId",
  asyncHandler(async (req, res) => {
    const repo = getConnectionRepository();
    const semanticRepo = getSemanticRepository();
    const ragAgent = getRagAgentDep();
    const deleted = await repo.delete(req.params.connectionId);
    if (!deleted) throw new HttpError(404, "Connection not found");
    // Without this, the connection's semantic model versions and RAG index
    // entries outlive it - a stale index entry can then win a future
    // question's routing match and raise a "no longer exists" error for a
    // completely unrelated question.
    await semanticRepo.deleteAllForDataSource(req.params.connectionId);
    await ragAgent.removeDataSource(req.params.connectionId);
    res.status(204).end();
  })
);

connectionsRouter.post(
  "/api/connections/:connectionId/set-default",
  asyncHandler(async (req, res) => {
    const repo = getConnectionRepository();
    const updated = await repo.setDefault(req.params.connectionId);
    if (!updated) throw new HttpError(404, "Connection not found");
    res.json(updated);
  })
);

connectionsRouter.post(
  "/api/connections/:connectionId/test",
  asyncHandler(async (req, res) => {
    const repo = getConnectionRepository();
    const model = await repo.getModel(req.params.connectionId);
    if (!model) throw new HttpError(404, "Connection not found");
    const registry = getDatasourceRegistry();
    try {
      const datasource = await registry.resolve(req.params.connectionId);
      const [success, message] = await datasource.testConnection();
      res.json({ success, message });
    } finally {
      await registry.closeAll();
    }
  })
);
