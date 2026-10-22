import { getLogger } from "../../core/logging";
import { EmbeddingProvider } from "./embeddings";
import { VectorStore } from "./vectorStore";

const logger = getLogger("services.rag.retriever");

const WORD_RE = /\w+/g;

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(WORD_RE) ?? []);
}

/**
 * Jaccard token overlap between the query and a candidate's indexed text - a
 * plain keyword signal, deliberately not an LLM call, blended into the
 * vector score below to catch cases where embedding similarity alone ranks a
 * topically-related but wrong concept above the one that actually shares the
 * question's exact wording.
 */
function lexicalOverlap(queryTokens: Set<string>, text: string): number {
  if (queryTokens.size === 0) return 0.0;
  const docTokens = tokenize(text);
  if (docTokens.size === 0) return 0.0;
  let intersectionSize = 0;
  for (const t of queryTokens) if (docTokens.has(t)) intersectionSize++;
  const unionSize = new Set([...queryTokens, ...docTokens]).size;
  return unionSize ? intersectionSize / unionSize : 0.0;
}

export interface RetrievalHit {
  name: string;
  type: string;
  entity: string;
  text: string;
  score: number;
  data_source_id: string | null;
}

export class SemanticRetriever {
  private readonly lexicalWeight: number;
  private readonly oversampleFactor: number;

  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly vectorStore: VectorStore,
    options: { lexicalWeight?: number; oversampleFactor?: number } = {}
  ) {
    // Clamped defensively - a value outside [0, 1] from misconfiguration
    // would otherwise let lexical overlap invert or outweigh the embedding
    // score in ways RAG_SCORE_THRESHOLD was never tuned for.
    this.lexicalWeight = Math.max(0.0, Math.min(1.0, options.lexicalWeight ?? 0.25));
    this.oversampleFactor = Math.max(1, options.oversampleFactor ?? 4);
  }

  async search(
    query: string,
    options: { docType?: string | null; dataSourceId?: string | null; topK?: number } = {}
  ): Promise<RetrievalHit[]> {
    const { docType = null, dataSourceId = null, topK = 5 } = options;
    const [embedding] = await this.embeddingProvider.embed([query]);
    const filterMetadata: Record<string, unknown> = {};
    if (docType) filterMetadata.type = docType;
    if (dataSourceId) filterMetadata.data_source_id = dataSourceId;

    const fetchK = this.lexicalWeight > 0 ? topK * this.oversampleFactor : topK;
    const results = await this.vectorStore.search(embedding, fetchK, Object.keys(filterMetadata).length ? filterMetadata : null);

    let hits: RetrievalHit[];
    if (this.lexicalWeight > 0 && results.length > 0) {
      const queryTokens = tokenize(query);
      const scored = results.map((r) => ({
        r,
        blended: (1 - this.lexicalWeight) * r.score + this.lexicalWeight * lexicalOverlap(queryTokens, r.text),
      }));
      scored.sort((a, b) => b.blended - a.blended);
      hits = scored.slice(0, topK).map(({ r, blended }) => ({
        name: (r.metadata.name as string) ?? "",
        type: (r.metadata.type as string) ?? "",
        entity: (r.metadata.entity as string) ?? "",
        text: r.text,
        score: blended,
        data_source_id: (r.metadata.data_source_id as string) ?? null,
      }));
    } else {
      hits = results.slice(0, topK).map((r) => ({
        name: (r.metadata.name as string) ?? "",
        type: (r.metadata.type as string) ?? "",
        entity: (r.metadata.entity as string) ?? "",
        text: r.text,
        score: r.score,
        data_source_id: (r.metadata.data_source_id as string) ?? null,
      }));
    }

    logger.info("semantic_retrieval_search", {
      query,
      doc_type: docType,
      data_source_id: dataSourceId,
      top_k: topK,
      hits: hits.map((h) => ({ name: h.name, type: h.type, entity: h.entity, score: h.score })),
    });
    return hits;
  }
}
