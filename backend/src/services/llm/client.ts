import OpenAI, { AzureOpenAI } from "openai";
import { getSettings } from "../../core/config";

// Supported values for `Settings.llmProvider` - anything else throws in both
// factories below. Kept as a shared tuple so the error message and any
// validation elsewhere stay in sync with what's actually implemented.
export const SUPPORTED_LLM_PROVIDERS = ["lmstudio", "azure_openai"] as const;

export interface ChatModel {
  provider: (typeof SUPPORTED_LLM_PROVIDERS)[number];
  /** The model name (lmstudio) or deployment name (azure_openai) to send as `model`. */
  model: string;
  client: OpenAI;
}

export interface EmbeddingsModel {
  provider: (typeof SUPPORTED_LLM_PROVIDERS)[number];
  model: string;
  client: OpenAI;
}

/**
 * The `openai` SDK's `AzureOpenAI` constructor throws synchronously
 * ("Missing credentials...") for a falsy `apiKey`/`endpoint`, unlike
 * LangChain's Python client, which accepts an empty string at construction
 * and only fails once a real request is attempted. An incomplete
 * `AZURE_OPENAI_*` config (present but not yet filled in) would otherwise
 * crash every route that touches `getChatModel()`/`getEmbeddingsModel()` -
 * including ones that have nothing to do with the LLM at all - instead of
 * failing gracefully at the moment an LLM call is actually made (where
 * `generateStructured`/`EmbeddingProvider.embed` already handle a
 * provider error). A placeholder keeps construction lazy the same way;
 * Azure itself will still reject the request with a real auth/DNS error.
 */
function orPlaceholder(value: string, placeholder: string): string {
  return value || placeholder;
}

let cachedChatModel: ChatModel | null = null;
let cachedSemanticPlannerModel: ChatModel | null = null;
let cachedToolCallingModel: ChatModel | null = null;
let cachedSqlModel: ChatModel | null = null;
let cachedEmbeddingsModel: EmbeddingsModel | null = null;

/**
 * The chat model every LLM-backed agent is built on, including DeepAgent's
 * own tool-calling orchestrator (see `agents/deepAgent.ts`) - that
 * orchestrator requires the returned model to reliably support native
 * OpenAI-style tool/function calling, not just plain JSON-schema structured
 * output.
 *
 * Selected purely by `LLM_PROVIDER` (`backend-ts/.env`) - agents depend on
 * this `ChatModel` interface only, never on a concrete provider, so the
 * backing LLM can be swapped via configuration alone, no code change
 * required:
 *
 * - `lmstudio` (default): a local, OpenAI-compatible LM Studio server.
 *   Tool-calling support then depends entirely on the loaded model's own
 *   chat template - not every local model implements it.
 * - `azure_openai`: an Azure OpenAI chat-completions deployment. Azure
 *   OpenAI's chat models (gpt-4o, gpt-4.1, etc.) support native tool calling
 *   robustly, making this the recommended provider whenever the LM Studio
 *   orchestrator reports it "did not call any tools".
 */
export function getChatModel(): ChatModel {
  if (cachedChatModel) return cachedChatModel;
  const settings = getSettings();
  const model = settings.llmProvider === "azure_openai" ? settings.azureOpenAiChatDeployment : settings.lmStudioModel;
  cachedChatModel = buildChatModel(model);
  return cachedChatModel;
}

/**
 * The model used for semantic-model generation (draft, relationship and
 * synonym suggestions) and the chat planner - `SEMANTIC_PLANNER_MODEL`
 * (e.g. microsoft/phi-4-mini-reasoning) on the same provider/endpoint as
 * `getChatModel()`, or the main chat model itself when that's unset. Neither
 * caller relies on tool calling (both use `generateStructured`), so a small
 * instruct model is enough here.
 */
export function getSemanticPlannerChatModel(): ChatModel {
  if (cachedSemanticPlannerModel) return cachedSemanticPlannerModel;
  const settings = getSettings();
  cachedSemanticPlannerModel = settings.semanticPlannerModel
    ? buildChatModel(settings.semanticPlannerModel)
    : getChatModel();
  return cachedSemanticPlannerModel;
}

/**
 * The model the SQL Agent and SQL Repair Agent generate/fix SQL with -
 * `SQL_AGENT_MODEL` (e.g. qwen/qwen3-4b-2507) on the same provider/endpoint
 * as `getChatModel()`, or the main chat model when unset. (SQL validation
 * itself is deterministic - see `services/sql/validator.ts`.)
 */
export function getSqlChatModel(): ChatModel {
  if (cachedSqlModel) return cachedSqlModel;
  const settings = getSettings();
  cachedSqlModel = settings.sqlAgentModel ? buildChatModel(settings.sqlAgentModel) : getChatModel();
  return cachedSqlModel;
}

/**
 * The model behind DeepAgent's tool-calling orchestrator loop -
 * `TOOL_CALLING_MODEL` (e.g. qwen3loop-0.6b-tool-calling-sft-v1) on the same
 * provider/endpoint as `getChatModel()`, or the main chat model when unset.
 * It must support native OpenAI-style tool/function calling; the
 * sub-agents the tools invoke (SQL, visualization, response, ...) keep using
 * the main chat model.
 */
export function getToolCallingChatModel(): ChatModel {
  if (cachedToolCallingModel) return cachedToolCallingModel;
  const settings = getSettings();
  cachedToolCallingModel = settings.toolCallingModel ? buildChatModel(settings.toolCallingModel) : getChatModel();
  return cachedToolCallingModel;
}

/** A chat client for `model` (lmstudio model name / azure_openai deployment
 * name) on the configured `LLM_PROVIDER`. */
function buildChatModel(model: string): ChatModel {
  const settings = getSettings();

  if (settings.llmProvider === "lmstudio") {
    return {
      provider: "lmstudio",
      model,
      client: new OpenAI({
        baseURL: settings.lmStudioBaseUrl,
        apiKey: settings.lmStudioApiKey || "lm-studio",
        timeout: settings.llmTimeoutSeconds * 1000,
      }),
    };
  }

  if (settings.llmProvider === "azure_openai") {
    return {
      provider: "azure_openai",
      model,
      client: new AzureOpenAI({
        endpoint: orPlaceholder(settings.azureOpenAiEndpoint, "https://not-configured.openai.azure.com"),
        apiKey: orPlaceholder(settings.azureOpenAiApiKey, "not-configured"),
        apiVersion: settings.azureOpenAiApiVersion,
        deployment: model,
        timeout: settings.llmTimeoutSeconds * 1000,
      }) as unknown as OpenAI,
    };
  }

  throw new Error(
    `Unsupported LLM_PROVIDER '${settings.llmProvider}'. Supported values: ${SUPPORTED_LLM_PROVIDERS.join(", ")}. ` +
      "Add a branch here pointing an OpenAI-compatible client at the new provider's API if you need another one."
  );
}

/**
 * The embeddings model used for RAG indexing/search, selected by the same
 * `LLM_PROVIDER` as `getChatModel()` - see its docstring. If no
 * embedding-capable model/deployment is configured for the active provider,
 * RAG indexing/search degrades to a local hashing-based embedding fallback
 * (see `services/rag/embeddings.ts`) rather than failing outright.
 */
export function getEmbeddingsModel(): EmbeddingsModel {
  if (cachedEmbeddingsModel) return cachedEmbeddingsModel;
  const settings = getSettings();

  if (settings.llmProvider === "lmstudio") {
    cachedEmbeddingsModel = {
      provider: "lmstudio",
      model: settings.lmStudioEmbeddingModel || settings.lmStudioModel,
      client: new OpenAI({
        baseURL: settings.lmStudioBaseUrl,
        apiKey: settings.lmStudioApiKey || "lm-studio",
        timeout: settings.llmTimeoutSeconds * 1000,
      }),
    };
    return cachedEmbeddingsModel;
  }

  if (settings.llmProvider === "azure_openai") {
    cachedEmbeddingsModel = {
      provider: "azure_openai",
      model: settings.azureOpenAiEmbeddingDeployment || settings.azureOpenAiChatDeployment,
      client: new AzureOpenAI({
        endpoint: orPlaceholder(settings.azureOpenAiEndpoint, "https://not-configured.openai.azure.com"),
        apiKey: orPlaceholder(settings.azureOpenAiApiKey, "not-configured"),
        apiVersion: settings.azureOpenAiApiVersion,
        deployment: settings.azureOpenAiEmbeddingDeployment || settings.azureOpenAiChatDeployment,
        timeout: settings.llmTimeoutSeconds * 1000,
      }) as unknown as OpenAI,
    };
    return cachedEmbeddingsModel;
  }

  throw new Error(`Unsupported LLM_PROVIDER '${settings.llmProvider}'. Supported values: ${SUPPORTED_LLM_PROVIDERS.join(", ")}.`);
}

/** Used by tests to force re-reading settings / injecting fakes. */
export function resetLlmClients(): void {
  cachedChatModel = null;
  cachedSemanticPlannerModel = null;
  cachedToolCallingModel = null;
  cachedSqlModel = null;
  cachedEmbeddingsModel = null;
}
