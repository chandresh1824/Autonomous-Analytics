import { getLogger } from "../core/logging";
import { SemanticModel } from "../schemas/semantic";
import { EmbeddingProvider } from "../services/rag/embeddings";
import { SemanticIndexer } from "../services/rag/indexer";
import { RetrievalHit, SemanticRetriever } from "../services/rag/retriever";
import { VectorStore } from "../services/rag/vectorStore";

const logger = getLogger("agents.ragAgent");

/**
 * Owns semantic-metadata indexing and similarity search. The Semantic
 * Agent's resolver falls back to this (via the shared `SemanticRetriever`)
 * only after exact-name, synonym and description matching have failed.
 */
export class RAGAgent {
  readonly indexer: SemanticIndexer;
  readonly retriever: SemanticRetriever;

  constructor(embeddingProvider: EmbeddingProvider, vectorStore: VectorStore, options: { lexicalWeight?: number; oversampleFactor?: number } = {}) {
    this.indexer = new SemanticIndexer(embeddingProvider, vectorStore);
    this.retriever = new SemanticRetriever(embeddingProvider, vectorStore, options);
  }

  async index(model: SemanticModel): Promise<number> {
    const count = await this.indexer.indexModel(model);
    logger.info("rag_index_refreshed", { document_count: count });
    return count;
  }

  /** Purges every indexed document for `dataSourceId` - called when the
   * owning connection is deleted. */
  async removeDataSource(dataSourceId: string): Promise<void> {
    await this.indexer.vectorStore.delete(null, { data_source_id: dataSourceId });
  }

  async search(query: string, options: { docType?: string | null; dataSourceId?: string | null; topK?: number } = {}): Promise<RetrievalHit[]> {
    return this.retriever.search(query, options);
  }

  /** Whether any documents are indexed for `dataSourceId`. */
  isIndexed(dataSourceId: string): boolean {
    return this.indexer.vectorStore.count({ data_source_id: dataSourceId }) > 0;
  }

  /**
   * Scores every indexed data source against `query`, best first. A source's
   * score blends its single best hit with the mean of its top
   * `perSourceTopK` hits, so one lucky document can't outrank a catalog that
   * matches the question broadly. One search over the whole (small) index,
   * so the query is embedded once.
   */
  async rankDataSources(
    query: string,
    options: { perSourceTopK?: number; maxDocuments?: number } = {}
  ): Promise<{ dataSourceId: string; score: number; topHits: RetrievalHit[] }[]> {
    const { perSourceTopK = 3, maxDocuments = 500 } = options;
    const topK = Math.min(Math.max(this.indexer.vectorStore.count(), 1), maxDocuments);
    const hits = await this.retriever.search(query, { docType: null, dataSourceId: null, topK });
    const bySource = new Map<string, RetrievalHit[]>();
    for (const hit of hits) {
      if (!hit.data_source_id) continue;
      const list = bySource.get(hit.data_source_id) ?? [];
      if (list.length < perSourceTopK) list.push(hit); // hits arrive best-first
      bySource.set(hit.data_source_id, list);
    }
    return [...bySource.entries()]
      .map(([dataSourceId, top]) => {
        const mean = top.reduce((sum, h) => sum + h.score, 0) / top.length;
        return { dataSourceId, score: 0.5 * top[0].score + 0.5 * mean, topHits: top };
      })
      .sort((a, b) => b.score - a.score);
  }
}
