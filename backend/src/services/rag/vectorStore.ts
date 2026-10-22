import fs from "node:fs";
import path from "node:path";

export interface VectorDocument {
  id: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
  score: number;
}

export interface VectorStore {
  addDocuments(documents: VectorDocument[]): Promise<void>;
  search(embedding: number[], topK?: number, filterMetadata?: Record<string, unknown> | null): Promise<SearchResult[]>;
  delete(ids?: string[] | null, filterMetadata?: Record<string, unknown> | null): Promise<void>;
  /** Number of stored documents, optionally only those matching the filter. */
  count(filterMetadata?: Record<string, unknown> | null): number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0.0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = (Math.sqrt(normA) || 1e-9) * (Math.sqrt(normB) || 1e-9);
  return dot / denom;
}

function matchesFilter(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => metadata[k] === v);
}

/**
 * File-backed vector store for local development.
 *
 * Persists documents + embeddings as JSON and performs a brute-force cosine
 * similarity scan on search. Intentionally dependency-free (no FAISS/Chroma/
 * native bindings) since the semantic-metadata corpus is small (entities/
 * dimensions/measures/KPIs, not raw rows) - exact brute-force cosine
 * similarity over a few thousand vectors is fast enough, and produces
 * numerically identical scores to an exact FAISS `IndexFlatIP` over
 * normalized vectors, which is what the original Python backend used by
 * default. Sits behind the same `VectorStore` interface so a production
 * vector database could be substituted later without touching callers.
 */
export class JsonVectorStore implements VectorStore {
  private documents = new Map<string, VectorDocument>();

  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as VectorDocument[];
    for (const item of raw) {
      this.documents.set(item.id, item);
    }
  }

  private persist(): void {
    const payload = [...this.documents.values()];
    fs.writeFileSync(this.filePath, JSON.stringify(payload));
  }

  async addDocuments(documents: VectorDocument[]): Promise<void> {
    for (const doc of documents) {
      this.documents.set(doc.id, doc);
    }
    this.persist();
  }

  async search(
    embedding: number[],
    topK = 5,
    filterMetadata?: Record<string, unknown> | null
  ): Promise<SearchResult[]> {
    let candidates = [...this.documents.values()];
    if (filterMetadata) {
      candidates = candidates.filter((d) => matchesFilter(d.metadata, filterMetadata));
    }
    const scored: SearchResult[] = candidates.map((d) => ({
      id: d.id,
      text: d.text,
      metadata: d.metadata,
      score: cosineSimilarity(embedding, d.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async delete(ids?: string[] | null, filterMetadata?: Record<string, unknown> | null): Promise<void> {
    if (ids != null) {
      for (const id of ids) this.documents.delete(id);
    } else if (filterMetadata) {
      for (const [id, doc] of this.documents) {
        if (matchesFilter(doc.metadata, filterMetadata)) this.documents.delete(id);
      }
    } else {
      this.documents.clear();
    }
    this.persist();
  }

  count(filterMetadata?: Record<string, unknown> | null): number {
    if (!filterMetadata) return this.documents.size;
    let n = 0;
    for (const doc of this.documents.values()) if (matchesFilter(doc.metadata, filterMetadata)) n += 1;
    return n;
  }
}
