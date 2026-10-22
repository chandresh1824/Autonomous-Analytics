import { z } from "zod";
import { AppError } from "../core/exceptions";
import { getLogger } from "../core/logging";
import { ConnectionRepository } from "../repositories/connectionRepository";
import { SemanticModelRepository } from "../repositories/semanticRepository";
import { SemanticModel } from "../schemas/semantic";
import { ChatModel } from "../services/llm/client";
import { generateStructured } from "../services/llm/structuredOutput";
import { RetrievalHit } from "../services/rag/retriever";
import { RAGAgent } from "./ragAgent";

const logger = getLogger("agents.dataSourceRouter");

// Per-candidate catalog text shown to the LLM tie-break - enough names for it
// to recognise the subject area without blowing a small model's context.
const MAX_CATALOG_CHARS = 1500;

const SYSTEM_PROMPT =
  "You route a business analytics question to the ONE database whose semantic catalog can answer it. " +
  "Each candidate lists its tables (entities), dimensions, measures, metrics and KPIs. " +
  "Pick the candidate whose catalog contains the subject of the question (e.g. the thing being " +
  "counted, summed or filtered). Match on meaning, not just shared words. Answer with the candidate's letter.";

const RouteChoiceSchema = z.object({
  candidate: z.string(),
  reason: z.string().default(""),
});

export interface RouteResult {
  /** The matched data source - equal to its `connections.id`. */
  dataSourceId: string;
  /** Display name of the matched connection (for progress/logs only). */
  dataSourceName: string;
  /** The data source's published semantic model. */
  model: SemanticModel;
  /** The data source's routing score (see `RAGAgent.rankDataSources`). */
  score: number;
  /** Best-matching catalog documents (KPI/metric/measure/dimension/entity)
   * from the matched data source, best first. */
  matches: RetrievalHit[];
  /** How the choice was made. */
  method: "rag" | "llm";
  /** The text the databases were ranked on. */
  searchText: string;
  /** Every candidate's routing score, best first. */
  ranking: { dataSourceName: string; score: number }[];
}

interface Candidate {
  dataSourceId: string;
  name: string;
  model: SemanticModel;
}

function catalogSummary(name: string, model: SemanticModel): string {
  const parts: string[] = [`Database: ${name}`];
  for (const e of model.entities) {
    parts.push(
      `Table ${e.table_name} (${e.name})${e.description ? ` - ${e.description}` : ""}` +
        `; dimensions: ${e.dimensions.map((d) => d.name).join(", ") || "-"}` +
        `; measures: ${e.measures.map((m) => m.name).join(", ") || "-"}`
    );
  }
  if (model.metrics.length) parts.push(`Metrics: ${model.metrics.map((m) => m.name).join(", ")}`);
  if (model.kpis.length) parts.push(`KPIs: ${model.kpis.map((k) => k.name).join(", ")}`);
  const text = parts.join("\n");
  return text.length > MAX_CATALOG_CHARS ? `${text.slice(0, MAX_CATALOG_CHARS)}...` : text;
}

/**
 * RAG step of the chat pipeline: finds which data source a question belongs
 * to by semantic search over every published catalog, and returns that data
 * source's id, semantic model and best-matching concepts.
 *
 * Works purely from application metadata (connection names/enabled flags and
 * published semantic models) - it never reads connection credentials or opens
 * a database connection; that happens only in the Execution Agent, for the
 * `data_source_id` chosen here.
 *
 * 1. Candidates are the enabled connections with a published semantic model.
 * 2. Any candidate missing from the RAG index is indexed first, so a failed
 *    index-on-publish can't make a data source unreachable.
 * 3. Candidates are ranked by RAG similarity; the leader must clear
 *    `scoreThreshold` (even when there is only one candidate), otherwise the
 *    question is rejected before any SQL is generated.
 * 4. If the runner-up is within `margin` of the leader, the LLM picks between
 *    the close candidates from their catalog summaries; if it fails or answers
 *    nonsense, the RAG leader wins.
 */
export class DataSourceRouter {
  constructor(
    private readonly connectionRepository: ConnectionRepository,
    private readonly semanticRepository: SemanticModelRepository,
    private readonly ragAgent: RAGAgent,
    private readonly chatModel: ChatModel,
    private readonly options: { scoreThreshold: number; margin: number }
  ) {}

  /**
   * Routes on `searchText` - the planner's subject, dimensions and filters,
   * free of time and phrasing words that match every catalog alike. If that
   * finds no database above the threshold, the whole `question` is tried
   * before giving up. The LLM tie-break always reads the whole question.
   */
  async route(searchText: string, question: string = searchText): Promise<RouteResult> {
    const candidates = await this.loadCandidates();
    if (!candidates.length) {
      throw new AppError("No database has a published semantic model yet. Publish one in Settings first.", 503);
    }
    await this.ensureIndexed(candidates);

    const byId = new Map(candidates.map((c) => [c.dataSourceId, c]));
    const rank = async (text: string) => {
      const ranked = (await this.ragAgent.rankDataSources(text)).filter((r) => byId.has(r.dataSourceId));
      logger.info("data_source_ranking", {
        search_text: text,
        ranking: ranked.map((r) => ({ data_source: byId.get(r.dataSourceId)!.name, score: Number(r.score.toFixed(3)) })),
      });
      return ranked;
    };
    let usedText = searchText.trim() || question;
    let ranked = await rank(usedText);
    if ((!ranked.length || ranked[0].score < this.options.scoreThreshold) && usedText !== question) {
      logger.info("data_source_routing_fell_back_to_question", { search_text: usedText, question });
      usedText = question;
      ranked = await rank(question);
    }
    if (!ranked.length || ranked[0].score < this.options.scoreThreshold) {
      throw new AppError(
        "None of the connected data sources has KPIs, measures or dimensions matching this question. " +
          "Try naming a specific KPI, metric, or dimension.",
        422
      );
    }

    let chosen = ranked[0];
    let method: RouteResult["method"] = "rag";
    const close = ranked.filter((r) => ranked[0].score - r.score <= this.options.margin);
    if (close.length > 1) {
      const index = await this.llmTieBreak(question, close.map((r) => byId.get(r.dataSourceId)!));
      if (index !== null) {
        chosen = close[index];
        method = "llm";
      }
    }

    const candidate = byId.get(chosen.dataSourceId)!;
    logger.info("data_source_routed", {
      method,
      data_source_id: candidate.dataSourceId,
      data_source: candidate.name,
      score: Number(chosen.score.toFixed(3)),
      matches: chosen.topHits.map((h) => `${h.type}:${h.name}`),
    });
    return {
      dataSourceId: candidate.dataSourceId,
      dataSourceName: candidate.name,
      model: candidate.model,
      score: chosen.score,
      matches: chosen.topHits,
      method,
      searchText: usedText,
      ranking: ranked.map((r) => ({ dataSourceName: byId.get(r.dataSourceId)!.name, score: r.score })),
    };
  }

  private async loadCandidates(): Promise<Candidate[]> {
    const [connections, models] = await Promise.all([
      this.connectionRepository.list(),
      this.semanticRepository.getAllActive(),
    ]);
    const candidates: Candidate[] = [];
    for (const conn of connections) {
      const model = models.get(conn.id);
      if (conn.enabled && model) candidates.push({ dataSourceId: conn.id, name: conn.name.trim(), model });
    }
    return candidates;
  }

  private async ensureIndexed(candidates: Candidate[]): Promise<void> {
    for (const c of candidates) {
      if (this.ragAgent.isIndexed(c.dataSourceId)) continue;
      try {
        await this.ragAgent.index(c.model);
        logger.warning("data_source_index_healed", { data_source_id: c.dataSourceId });
      } catch (exc) {
        logger.exception("data_source_index_heal_failed", { data_source_id: c.dataSourceId, error: String(exc) });
      }
    }
  }

  /** Index into `options` of the LLM's pick, or null if it failed. */
  private async llmTieBreak(query: string, options: Candidate[]): Promise<number | null> {
    const letters = options.map((_, i) => String.fromCharCode(65 + i));
    const listing = options.map((o, i) => `Candidate ${letters[i]}:\n${catalogSummary(o.name, o.model)}`).join("\n\n");
    try {
      const choice = await generateStructured(this.chatModel, {
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: `Question: ${query}\n\n${listing}\n\nWhich candidate (${letters.join(" or ")}) can answer the question?`,
        schema: RouteChoiceSchema,
        maxRetries: 1,
      });
      const index = letters.indexOf(choice.candidate.trim().toUpperCase().charAt(0));
      if (index < 0) {
        logger.warning("data_source_llm_choice_invalid", { answer: choice.candidate });
        return null;
      }
      logger.info("data_source_llm_choice", { candidate: letters[index], data_source: options[index].name, reason: choice.reason });
      return index;
    } catch (exc) {
      logger.warning("data_source_llm_choice_failed", { error: String(exc) });
      return null;
    }
  }
}

/**
 * Indexes every published semantic model that has no RAG documents yet -
 * run once at startup so a model whose index-on-publish failed (e.g. the
 * embeddings server was down) is still routable.
 */
export async function healMissingRagIndexes(semanticRepository: SemanticModelRepository, ragAgent: RAGAgent): Promise<void> {
  for (const [dataSourceId, model] of await semanticRepository.getAllActive()) {
    if (ragAgent.isIndexed(dataSourceId)) continue;
    try {
      const count = await ragAgent.index(model);
      logger.warning("startup_rag_index_healed", { data_source_id: dataSourceId, document_count: count });
    } catch (exc) {
      logger.exception("startup_rag_index_heal_failed", { data_source_id: dataSourceId, error: String(exc) });
    }
  }
}
