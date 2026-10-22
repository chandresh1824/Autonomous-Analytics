import crypto from "node:crypto";
import { getLogger } from "../../core/logging";
import { EmbeddingsModel } from "../llm/client";

const logger = getLogger("services.rag.embeddings");

export const EMBEDDING_DIM = 256;

/**
 * Deterministic bag-of-words hashing embedding.
 *
 * Used as an offline fallback whenever the configured LLM provider has no
 * reachable embeddings endpoint (e.g. LM Studio without an embedding model
 * loaded, or during tests without a running LM Studio instance at all), so
 * RAG indexing/retrieval keeps working without a live LLM connection.
 */
function hashEmbedding(text: string, dim: number = EMBEDDING_DIM): number[] {
  const vector = new Array(dim).fill(0);
  for (const token of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    const digest = crypto.createHash("sha256").update(token, "utf8").digest("hex");
    // Python used `int(digest, 16) % dim` on the full 256-bit hex digest;
    // BigInt reproduces that exactly rather than truncating to a JS number.
    const index = Number(BigInt(`0x${digest}`) % BigInt(dim));
    vector[index] += 1.0;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1.0;
  return vector.map((v) => v / norm);
}

/** True for an empty vector, or one whose values are all exactly zero (or
 * non-finite) - a real embedding model never returns an all-zero vector for
 * non-empty text, but some OpenAI-compatible local servers (e.g. LM Studio
 * with a chat-only model loaded under the embeddings model name, or one
 * that failed to load at all) respond 200 OK with exactly this shape instead
 * of a proper error, which `embeddings.create()` alone can't distinguish
 * from a genuine embedding. Left undetected, every document and query end
 * up with the same meaningless zero vector, cosine similarity comes out
 * ~0 for everything, and RAG-based connection routing/resolution fails as
 * if nothing were indexed at all - the exact failure mode this guards
 * against. */
function isDegenerateVector(vector: unknown): boolean {
  if (!Array.isArray(vector) || vector.length === 0) return true;
  return vector.every((v) => typeof v !== "number" || !Number.isFinite(v) || v === 0);
}

export class EmbeddingProvider {
  constructor(private readonly embeddingsModel: EmbeddingsModel) {}

  async embed(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.embeddingsModel.client.embeddings.create({
        model: this.embeddingsModel.model,
        input: texts,
        // Must be explicit: omitting it makes the SDK request base64 internally,
        // and its decode path yields a truncated all-zero array against LM
        // Studio - which then trips the degenerate-vector check below and
        // silently downgrades every embedding to the hashing fallback.
        encoding_format: "float",
      });
      const embeddings = response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding as number[]);
      if (embeddings.length !== texts.length || embeddings.some(isDegenerateVector)) {
        throw new Error(
          `Embeddings endpoint for model '${this.embeddingsModel.model}' returned no usable (non-zero) vectors - ` +
            "it's likely not a real embedding model, or isn't currently loaded."
        );
      }
      return embeddings;
    } catch (exc) {
      logger.warning("embedding_fallback_to_hash", { error: String((exc as Error)?.message ?? exc) });
      return texts.map((t) => hashEmbedding(t));
    }
  }
}
