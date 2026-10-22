import fs from "node:fs";
import path from "node:path";
import { ResolvedFilter } from "../schemas/agent";
import { QueryShapeResult } from "../schemas/queryShape";
import { SemanticModel } from "../schemas/semantic";
import { GeneratedSQL, GeneratedSQLSchema } from "../schemas/sql";
import { ChatModel } from "../services/llm/client";
import { generateStructured } from "../services/llm/structuredOutput";
import { SemanticResolution } from "../services/semantic/resolver";
import { backtickAliasReferences } from "../services/sql/mysqlSyntax";
import { buildGroundingContext } from "./sqlAgent";

const PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "sql_repair.txt");

/**
 * Invoked only when validation or execution fails. Bounded by
 * `maxSqlRepairAttempts` at the orchestrator level - never retries
 * endlessly.
 */
export class SQLRepairAgent {
  private readonly systemPrompt: string;

  constructor(
    private readonly model: SemanticModel,
    private readonly chatModel: ChatModel,
    private readonly maxRows: number
  ) {
    this.systemPrompt = fs.readFileSync(PROMPT_PATH, "utf-8");
  }

  async repair(
    previousSql: string | null,
    resolution: SemanticResolution,
    errors: string[],
    plannerFilters: ResolvedFilter[] = [],
    shape: QueryShapeResult | null = null
  ): Promise<GeneratedSQL> {
    // Same grounding as generation, including trend bucketing - without the
    // shape a repaired query would silently drop the time buckets.
    const grounding = buildGroundingContext(this.model, resolution, plannerFilters, shape);
    const userPrompt =
      `Grounding context:\n${grounding}\n\n` +
      `Maximum row limit: ${this.maxRows}\n\n` +
      `Previous SQL:\n${previousSql}\n\n` +
      `Errors reported:\n${JSON.stringify(errors)}\n\n` +
      "Produce a corrected SQL query.";
    const generated = await generateStructured(this.chatModel, {
      systemPrompt: this.systemPrompt,
      userPrompt,
      schema: GeneratedSQLSchema,
    });
    return { ...generated, sql: backtickAliasReferences(generated.sql) };
  }
}
