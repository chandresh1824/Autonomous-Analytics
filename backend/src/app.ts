import cors from "cors";
import express, { Express } from "express";
import { requireUser } from "./core/auth";
import { getSettings } from "./core/config";
import { errorHandlerMiddleware } from "./api/errorHandler";
import { chatRouter } from "./api/routes/chat";
import { connectionsRouter } from "./api/routes/connections";
import { dashboardRouter } from "./api/routes/dashboard";
import { healthRouter } from "./api/routes/health";
import { kpisRouter } from "./api/routes/kpis";
import { logsRouter } from "./api/routes/logs";
import { metricsRouter } from "./api/routes/metrics";
import { semanticModelRouter } from "./api/routes/semanticModel";

export function createApp(): Express {
  const settings = getSettings();
  const app = express();

  app.use(
    cors({
      origin: settings.frontendUrl,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["*"],
    })
  );
  app.use(express.json({ limit: "10mb" }));

  // Health checks (Docker, load balancers) answer without a login. Everything
  // else - chat, dashboard, connections, semantic model, KPIs, metrics, logs -
  // needs a valid Entra sign-in token. CORS preflights are answered above,
  // before this runs.
  app.use(healthRouter);
  app.use(requireUser);

  app.use(chatRouter);
  app.use(connectionsRouter);
  app.use(semanticModelRouter);
  app.use(kpisRouter);
  app.use(metricsRouter);
  app.use(logsRouter);
  app.use(dashboardRouter);

  app.use(errorHandlerMiddleware);

  return app;
}
