import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

// Project root is two levels up from this file once compiled (dist/core -> dist -> backend-ts),
// and two levels up from src/core in dev (src/core -> src -> backend-ts) - either way the
// package root, matching Python's `Path(__file__).resolve().parents[2]` from app/core/config.py.
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function num(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export interface Settings {
  appEnv: string;
  logLevel: string;

  backendHost: string;
  backendPort: number;

  frontendUrl: string;

  // Which backing LLM provider DeepAgent's chat model (and its embeddings model)
  // is built from - see services/llm/client.ts. "lmstudio" (default) talks to a
  // local OpenAI-compatible LM Studio server; "azure_openai" talks to an Azure
  // OpenAI chat-completions deployment, which supports native tool/function
  // calling more reliably than most local models.
  llmProvider: string;

  lmStudioBaseUrl: string;
  lmStudioApiKey: string;
  lmStudioModel: string;
  lmStudioEmbeddingModel: string;

  azureOpenAiEndpoint: string;
  azureOpenAiApiKey: string;
  azureOpenAiApiVersion: string;
  azureOpenAiChatDeployment: string;
  azureOpenAiEmbeddingDeployment: string;

  // Separate model for semantic-model generation (draft, relationship and
  // synonym suggestions) and the chat planner - a model name for lmstudio,
  // a deployment name for azure_openai, on the same provider/endpoint as the
  // main chat model. Empty falls back to the main chat model.
  semanticPlannerModel: string;
  // Separate model for DeepAgent's tool-calling orchestrator (same provider
  // and naming rules as above). Empty falls back to the main chat model.
  toolCallingModel: string;
  // Separate model for the SQL Agent and SQL Repair Agent (same provider and
  // naming rules as above). Empty falls back to the main chat model.
  sqlAgentModel: string;
  // How many selected tables semantic-model generation drafts at once. Only
  // speeds things up if the LLM server serves parallel requests (LM Studio:
  // raise the model's "Max Concurrent Predictions"); otherwise requests just
  // queue and the later ones risk LLM_TIMEOUT_SECONDS - use 1 then.
  semanticGenerationConcurrency: number;
  // Columns of one table classified per LLM call during generation - smaller
  // batches mean shorter answers that finish well inside the LLM timeout.
  semanticGenerationBatchSize: number;
  // Client timeout for every LLM request, in seconds.
  llmTimeoutSeconds: number;

  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;

  vectorStorePath: string;

  maxQueryRows: number;
  queryTimeoutSeconds: number;
  maxSqlRepairAttempts: number;

  ragScoreThreshold: number;
  ragLexicalWeight: number;
  ragOversampleFactor: number;
  connectionRoutingScoreThreshold: number;
  // When the runner-up database's routing score is within this of the
  // leader's, the LLM picks between them from their catalogs.
  connectionRoutingMargin: number;
  kpiPreferenceMargin: number;

  secretKey: string;

  // Microsoft Entra ID tenant and SPA app (client) id - the same values as
  // the frontend's VITE_AZURE_ENTRA_TENANT_ID / VITE_AZURE_ENTRA_CLIENT_ID.
  // Used to verify the sign-in token on per-user routes (chat, dashboard).
  entraTenantId: string;
  entraClientId: string;

  resolvedVectorStorePath: string;
}

function resolveUnderRoot(candidate: string): string {
  return path.isAbsolute(candidate) ? candidate : path.resolve(PACKAGE_ROOT, candidate);
}

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;

  const vectorStorePath = str("VECTOR_STORE_PATH", "./data/vector_store");

  cached = {
    appEnv: str("APP_ENV", "development"),
    logLevel: str("LOG_LEVEL", "INFO"),

    backendHost: str("BACKEND_HOST", "0.0.0.0"),
    backendPort: num("BACKEND_PORT", 8000),

    frontendUrl: str("FRONTEND_URL", "http://localhost:5173"),

    llmProvider: str("LLM_PROVIDER", "lmstudio"),

    lmStudioBaseUrl: str("LM_STUDIO_BASE_URL", "http://localhost:1234/v1"),
    lmStudioApiKey: str("LM_STUDIO_API_KEY", "lm-studio"),
    lmStudioModel: str("LM_STUDIO_MODEL", ""),
    lmStudioEmbeddingModel: str("LM_STUDIO_EMBEDDING_MODEL", ""),

    azureOpenAiEndpoint: str("AZURE_OPENAI_ENDPOINT", ""),
    azureOpenAiApiKey: str("AZURE_OPENAI_API_KEY", ""),
    azureOpenAiApiVersion: str("AZURE_OPENAI_API_VERSION", "2024-08-01-preview"),
    azureOpenAiChatDeployment: str("AZURE_OPENAI_CHAT_DEPLOYMENT", ""),
    azureOpenAiEmbeddingDeployment: str("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", ""),

    semanticPlannerModel: str("SEMANTIC_PLANNER_MODEL", ""),
    toolCallingModel: str("TOOL_CALLING_MODEL", ""),
    sqlAgentModel: str("SQL_AGENT_MODEL", ""),
    semanticGenerationConcurrency: num("SEMANTIC_GENERATION_CONCURRENCY", 1),
    semanticGenerationBatchSize: num("SEMANTIC_GENERATION_BATCH_SIZE", 6),
    llmTimeoutSeconds: num("LLM_TIMEOUT_SECONDS", 180),

    dbHost: str("DB_HOST", ""),
    dbPort: num("DB_PORT", 3306),
    dbName: str("DB_NAME", ""),
    dbUser: str("DB_USER", ""),
    dbPassword: str("DB_PASSWORD", ""),

    vectorStorePath,

    maxQueryRows: num("MAX_QUERY_ROWS", 1000),
    queryTimeoutSeconds: num("QUERY_TIMEOUT_SECONDS", 30),
    maxSqlRepairAttempts: num("MAX_SQL_REPAIR_ATTEMPTS", 2),

    ragScoreThreshold: num("RAG_SCORE_THRESHOLD", 0.32),
    ragLexicalWeight: num("RAG_LEXICAL_WEIGHT", 0.25),
    ragOversampleFactor: num("RAG_OVERSAMPLE_FACTOR", 4),
    connectionRoutingScoreThreshold: num("CONNECTION_ROUTING_SCORE_THRESHOLD", 0.45),
    connectionRoutingMargin: num("CONNECTION_ROUTING_MARGIN", 0.08),
    kpiPreferenceMargin: num("KPI_PREFERENCE_MARGIN", -0.05),

    secretKey: str("SECRET_KEY", "change-me-in-production"),

    entraTenantId: str("AZURE_ENTRA_TENANT_ID", ""),
    entraClientId: str("AZURE_ENTRA_CLIENT_ID", ""),

    resolvedVectorStorePath: resolveUnderRoot(vectorStorePath),
  };
  return cached;
}

export function resetSettingsForTests(): void {
  cached = null;
}
