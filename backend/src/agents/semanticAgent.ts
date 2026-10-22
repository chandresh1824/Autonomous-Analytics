import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getLogger } from "../core/logging";
import { SemanticContextItem } from "../schemas/agent";
import { Plan } from "../schemas/planner";
import { SemanticModel } from "../schemas/semantic";
import { ChatModel } from "../services/llm/client";
import { generateStructured } from "../services/llm/structuredOutput";
import { SemanticRetriever } from "../services/rag/retriever";
import { SemanticResolution, SemanticResolver } from "../services/semantic/resolver";

const logger = getLogger("agents.semanticAgent");
const PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "semantic.txt");

const ClarificationMessageSchema = z.object({ message: z.string() });

/**
 * Runs RAG retrieval + the Semantic Resolver to turn the Planner's phrases
 * into grounded semantic-model concepts, and (only when something could not
 * be resolved) asks the LLM to phrase a clarification instead of guessing.
 */
export class SemanticAgent {
  private readonly resolver: SemanticResolver;
  private readonly systemPrompt: string;

  constructor(
    private readonly model: SemanticModel,
    private readonly chatModel: ChatModel,
    private readonly retriever: SemanticRetriever | null = null,
    options: { scoreThreshold?: number; kpiPreferenceMargin?: number } = {}
  ) {
    this.resolver = new SemanticResolver(
      model,
      retriever,
      options.scoreThreshold,
      options.kpiPreferenceMargin,
      undefined,
      undefined
    );
    this.systemPrompt = fs.readFileSync(PROMPT_PATH, "utf-8");
  }

  async run(plan: Plan): Promise<[SemanticResolution, SemanticContextItem[]]> {
    const resolution = await this.resolver.resolvePlan(plan);
    const semanticContext = this.buildContext(resolution);
    return [resolution, semanticContext];
  }

  private buildContext(resolution: SemanticResolution): SemanticContextItem[] {
    const context: SemanticContextItem[] = [];
    for (const kpiName of resolution.kpis) {
      const kpi = this.model.getKpi(kpiName);
      if (kpi) {
        context.push({ type: "kpi", entity: "", name: kpi.name, description: kpi.description, score: resolution.scores[kpi.name] ?? 1.0 });
      }
    }
    for (const metricName of resolution.metrics) {
      const metric = this.model.resolveMetricOrMeasure(metricName);
      if (metric) {
        context.push({
          type: "metric",
          entity: "",
          name: metric.name,
          description: metric.description,
          score: resolution.scores[metric.name] ?? 1.0,
        });
      }
    }
    for (const dimName of resolution.dimensions) {
      const found = this.model.findDimension(dimName);
      if (found) {
        const [entity, dim] = found;
        context.push({ type: "dimension", entity: entity.name, name: dim.name, description: dim.description, score: resolution.scores[dim.name] ?? 1.0 });
      }
    }
    for (const entityName of resolution.entities) {
      const entity = this.model.getEntity(entityName);
      if (entity) {
        context.push({ type: "entity", entity: entity.name, name: entity.name, description: entity.description, score: 1.0 });
      }
    }
    return context;
  }

  async clarify(unresolved: string[]): Promise<string> {
    const supported = await this.closestSupportedConcepts(unresolved);
    const userPrompt = `Unresolved phrases: ${JSON.stringify(unresolved)}\nClosest supported concepts: ${supported}\nWrite the clarification message.`;
    try {
      const result = await generateStructured(this.chatModel, {
        systemPrompt: this.systemPrompt,
        userPrompt,
        schema: ClarificationMessageSchema,
      });
      return result.message;
    } catch (exc) {
      logger.warning("semantic_clarify_llm_failed", { error: String(exc) });
      const phrases = unresolved.map((p) => p.split(":").slice(1).join(":") || p).join(", ");
      return (
        `The semantic model does not currently define a concept for: ${phrases}. ` +
        `Try one of the supported concepts instead: ${supported}.`
      );
    }
  }

  /** Finds the genuinely closest KPI/dimension names via the same RAG search
   * used for real matching, instead of dumping the entire catalog. */
  private async closestSupportedConcepts(unresolved: string[], topK = 5): Promise<string> {
    const phrases = unresolved.filter(Boolean).map((p) => p.split(":").slice(1).join(":") || p);
    const query = phrases.join(" ").trim();
    if (!this.retriever || !query) {
      const names = [...this.model.allKpiNames(), ...this.model.allDimensionNames()];
      return names.length ? names.slice(0, topK).join(", ") : "(none defined)";
    }

    const [kpiHits, dimHits] = await Promise.all([
      this.retriever.search(query, { docType: "kpi", dataSourceId: this.model.data_source_id, topK }),
      this.retriever.search(query, { docType: "dimension", dataSourceId: this.model.data_source_id, topK }),
    ]);
    const names = [...new Set([...kpiHits, ...dimHits].map((h) => h.name))];
    return names.length ? names.join(", ") : "(none defined)";
  }
}
