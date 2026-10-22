import { RAGAgent } from "../agents/ragAgent";
import { getSettings, Settings } from "../core/config";
import { ConnectionRepository } from "../repositories/connectionRepository";
import { ConversationRepository } from "../repositories/conversationRepository";
import { getDb } from "../repositories/db";
import { KPIRepository } from "../repositories/kpiRepository";
import { MetricRepository } from "../repositories/metricRepository";
import { ConnectionRow } from "../repositories/models";
import { PinnedWidgetRepository } from "../repositories/pinnedWidgetRepository";
import { SemanticModelRepository } from "../repositories/semanticRepository";
import { DataSourceRegistry } from "../services/datasource/registry";
import {
  ChatModel,
  getChatModel,
  getEmbeddingsModel,
  getSemanticPlannerChatModel,
  getSqlChatModel,
  getToolCallingChatModel,
} from "../services/llm/client";
import { EmbeddingProvider } from "../services/rag/embeddings";
import { JsonVectorStore, VectorStore } from "../services/rag/vectorStore";
import path from "node:path";

let embeddingProvider: EmbeddingProvider | null = null;
let vectorStore: VectorStore | null = null;
let ragAgent: RAGAgent | null = null;

export function getChatModelDep(): ChatModel {
  return getChatModel();
}

export function getSemanticPlannerChatModelDep(): ChatModel {
  return getSemanticPlannerChatModel();
}

export function getToolCallingChatModelDep(): ChatModel {
  return getToolCallingChatModel();
}

export function getSqlChatModelDep(): ChatModel {
  return getSqlChatModel();
}

export function getSettingsDep(): Settings {
  return getSettings();
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!embeddingProvider) {
    embeddingProvider = new EmbeddingProvider(getEmbeddingsModel());
  }
  return embeddingProvider;
}

export function getVectorStore(): VectorStore {
  if (!vectorStore) {
    const settings = getSettings();
    vectorStore = new JsonVectorStore(path.join(settings.resolvedVectorStorePath, "semantic_index.json"));
  }
  return vectorStore;
}

export function getRagAgentDep(): RAGAgent {
  if (!ragAgent) {
    const settings = getSettings();
    ragAgent = new RAGAgent(getEmbeddingProvider(), getVectorStore(), {
      lexicalWeight: settings.ragLexicalWeight,
      oversampleFactor: settings.ragOversampleFactor,
    });
  }
  return ragAgent;
}

export function getConnectionRepository(): ConnectionRepository {
  return new ConnectionRepository(getDb());
}

export function getSemanticRepository(): SemanticModelRepository {
  return new SemanticModelRepository(getDb());
}

export function getKpiRepository(): KPIRepository {
  return new KPIRepository(getDb());
}

export function getMetricRepository(): MetricRepository {
  return new MetricRepository(getDb());
}

export function getConversationRepository(): ConversationRepository {
  return new ConversationRepository(getDb());
}

export function getPinnedWidgetRepository(): PinnedWidgetRepository {
  return new PinnedWidgetRepository(getDb());
}

export function getDatasourceRegistry(): DataSourceRegistry {
  // A fresh registry per request - each route that resolves a datasource is
  // responsible for calling `closeAll()` itself once it's truly done (see
  // chat.ts), the same way the original FastAPI dependency deliberately
  // never closed on its own teardown for the streaming endpoint.
  return new DataSourceRegistry(getConnectionRepository());
}

/** Resolves the request's target connection (explicit `connectionId`, or the
 * default enabled one). A connection's id doubles as the `data_source_id`
 * that scopes which database's semantic model/RAG index a request reasons
 * about. */
export async function resolveConnection(connectionId?: string | null): Promise<ConnectionRow> {
  const repo = getConnectionRepository();
  return repo.resolve(connectionId);
}
