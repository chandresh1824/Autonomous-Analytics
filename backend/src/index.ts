import { healMissingRagIndexes } from "./agents/dataSourceRouter";
import { getRagAgentDep, getSemanticRepository } from "./api/dependencies";
import { createApp } from "./app";
import { getSettings } from "./core/config";
import { configureLogging, getLogger } from "./core/logging";
import { disposeDb, initDb } from "./repositories/db";

const logger = getLogger("index");

async function main(): Promise<void> {
  const settings = getSettings();
  configureLogging(settings.logLevel);
  // Creates the application's tables on an empty database and no-ops thereafter - the whole schema process, with no separate migration step.
  await initDb();

  logger.info("startup_complete", { app_env: settings.appEnv, database: settings.dbName, host: settings.dbHost });

  const app = createApp();
  const server = app.listen(settings.backendPort, settings.backendHost, () => {
    logger.info("server_listening", { host: settings.backendHost, port: settings.backendPort });
  });

  // Background, so a slow/down embeddings server never delays startup.
  void healMissingRagIndexes(getSemanticRepository(), getRagAgentDep()).catch((err) =>
    logger.exception("startup_rag_index_heal_failed", { error: String(err) })
  );

  const shutdown = () => {
    logger.info("shutdown_complete", { app_env: settings.appEnv });
    server.close(() => {
      void disposeDb().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
