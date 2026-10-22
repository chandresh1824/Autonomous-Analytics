import { Router } from "express";
import { getRecentLogs } from "../../core/logging";

export const logsRouter = Router();

/** Recent backend log entries (in-memory, most recent first) - lets the
 * Settings UI surface what actually went wrong without needing console
 * access to the backend process. */
logsRouter.get("/api/logs", (req, res) => {
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit ?? 200)));
  const level = typeof req.query.level === "string" ? req.query.level : undefined;
  const query = typeof req.query.q === "string" ? req.query.q : undefined;
  res.json(getRecentLogs({ limit, level, query }));
});
