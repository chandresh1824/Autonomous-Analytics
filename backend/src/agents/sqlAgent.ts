import fs from "node:fs";
import path from "node:path";
import { getLogger } from "../core/logging";
import { ResolvedFilter } from "../schemas/agent";
import { QueryShapeResult } from "../schemas/queryShape";
import { Dimension, Entity, SemanticModel } from "../schemas/semantic";
import { GeneratedSQL, GeneratedSQLSchema } from "../schemas/sql";
import { ChatModel } from "../services/llm/client";
import { generateStructured } from "../services/llm/structuredOutput";
import { SemanticResolution } from "../services/semantic/resolver";
import {
  backtickAliasReferences,
  dateBucketExpression,
  defaultPeriodOverPeriodWindow,
  mysqlSyntaxNotes,
} from "../services/sql/mysqlSyntax";
import { SQLBuilder } from "../services/sql/generator";
import { resolutionScopedColumns } from "../services/sql/validator";
import { SQLGenerationError } from "../core/exceptions";

const logger = getLogger("agents.sqlAgent");
const PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "sql.txt");

/** Renders a measure's aggregation as the literal SQL expression to use -
 * `count_distinct` in particular has no single-keyword SQL form. */
function aggregationSql(aggregation: string, column: string): string {
  const agg = aggregation.toLowerCase();
  if (agg === "count_distinct") return `COUNT(DISTINCT ${column})`;
  return `${agg.toUpperCase()}(${column})`;
}

/**
 * The resolved KPI/metric's OWN time field, for bucketing a trend or
 * period-over-period question - never a literal "week"/"month" dimension,
 * which does not exist in any catalog (see planner.txt's CRITICAL note).
 * Found generically from whichever KPI/metric was already resolved, by
 * picking the one declared-supported dimension whose datatype is date-like -
 * the same "datatype mentions date/time" heuristic this prompt's own rules
 * already use to decide whether a filtered column needs a `DATE(...)` wrap.
 */
function findTimeDimension(model: SemanticModel, resolution: SemanticResolution): [Entity, Dimension] | null {
  // The date field the Resolver matched for this question's period/buckets.
  if (resolution.time_dimension) {
    const resolved = model.findDimension(resolution.time_dimension);
    if (resolved) return resolved;
  }
  const candidateNames = new Set<string>();
  for (const kpiName of resolution.kpis) {
    const kpi = model.getKpi(kpiName);
    if (kpi) for (const name of kpi.supported_dimensions) candidateNames.add(name);
  }
  for (const metricName of resolution.metrics) {
    const metric = model.resolveMetricOrMeasure(metricName);
    if (metric) for (const name of metric.supported_dimensions) candidateNames.add(name);
  }
  for (const name of candidateNames) {
    const found = model.findDimension(name);
    if (found && /date|time/i.test(found[1].datatype)) return found;
  }
  return null;
}

export function buildGroundingContext(
  model: SemanticModel,
  resolution: SemanticResolution,
  plannerFilters: ResolvedFilter[] = [],
  shape: QueryShapeResult | null = null
): string {
  const lines: string[] = [mysqlSyntaxNotes()];
  const entityNames = resolution.entities.length ? resolution.entities : model.entities.map((e) => e.name);
  const allowedColumns = resolutionScopedColumns(model, resolution);
  for (const f of plannerFilters) {
    const found = model.findDimension(f.field);
    if (found) allowedColumns.add(found[1].column_name.toLowerCase());
  }

  // Never resolved into `resolution.dimensions` (there is no dimension
  // literally named "week"/"month" - see planner.txt) so its column
  // would otherwise be rejected by the validator as "not in the semantic
  // model" the moment the LLM references it for the bucket expression below.
  const timeBucket = shape?.trend_granularity ? findTimeDimension(model, resolution) : null;
  if (timeBucket) allowedColumns.add(timeBucket[1].column_name.toLowerCase());
  for (const entityName of entityNames) {
    const entity = model.getEntity(entityName);
    if (!entity) continue;
    const visibleDims = entity.dimensions.filter((d) => allowedColumns.has(d.column_name.toLowerCase()));
    const columns = visibleDims.map((d) => `\`${d.column_name}\` (${d.name})`).join(", ");
    lines.push(
      `SQL table name (use exactly this, never the entity name below): ${entity.table_name}\n` +
        `  Business entity name (context only, NOT a valid SQL identifier): '${entity.name}'\n` +
        `  Columns (ONLY these are valid - never reference any other column, even one that ` +
        `seems like a natural fit): ${columns}`
    );
    for (const dim of entity.dimensions) {
      if (dim.reference) {
        const targetEntity = model.getEntity(dim.reference.target_entity);
        const targetTable = targetEntity ? targetEntity.table_name : dim.reference.target_entity;
        lines.push(`  Join: ${entity.table_name}.${dim.column_name} -> ${targetTable}.${dim.reference.target_key}`);
      }
    }
  }
  for (const metricName of resolution.metrics) {
    const metric = model.resolveMetricOrMeasure(metricName);
    if (metric) {
      const foundMeasure = model.findMeasure(metric.base_measure);
      if (foundMeasure) {
        const measure = foundMeasure[1];
        const aggSql = aggregationSql(measure.aggregation, measure.expression);
        lines.push(
          `Metric '${metric.name}': aggregate as ${aggSql} - the column name is EXACTLY ` +
            `\`${measure.expression}\`, not a more "natural"-sounding name you might expect for ` +
            "this kind of entity (e.g. never CASE_NUMBER, CASE_ID, or similar - if the real " +
            "column happens to be a bare word like `number`, that IS the column) - base measure " +
            `'${metric.base_measure}'. ${metric.description} In the SELECT list, alias this ` +
            `expression EXACTLY as "${metric.name}" (e.g. \`${aggSql} AS "${metric.name}"\`).`
        );
      } else {
        lines.push(
          `Metric '${metric.name}': base measure '${metric.base_measure}'. ${metric.description} ` +
            `In the SELECT list, alias this expression EXACTLY as "${metric.name}".`
        );
      }
    }
  }
  for (const kpiName of resolution.kpis) {
    const kpi = model.getKpi(kpiName);
    if (kpi) {
      const filterLogic = kpi.default_filter_logic ? JSON.stringify(kpi.default_filter_logic) : "none";
      lines.push(
        `KPI '${kpi.name}': formula ${kpi.formula}, required grouping: ${JSON.stringify(kpi.required_grouping_dimensions)}, ` +
          `default filter logic: ${filterLogic}`
      );
    }
  }
  const dimColumns: string[] = [];
  const dimAliases: string[] = [];
  for (const dimName of resolution.dimensions) {
    const found = model.findDimension(dimName);
    if (found) {
      dimColumns.push(found[1].column_name);
      dimAliases.push(`\`${found[1].column_name}\` AS "${found[1].name}"`);
    }
  }
  if (resolution.metrics.length) {
    if (dimColumns.length) {
      lines.push(
        "Required GROUP BY dimensions (include EVERY one of these as its own column in both " +
          "the SELECT list and the GROUP BY clause - never omit one, even if the question named " +
          "several). Alias each one in the SELECT list EXACTLY as shown here: " + dimAliases.join(", ")
      );
    }
  } else {
    if (dimColumns.length) {
      lines.push(
        "Required SELECT columns (list these as their own columns in SELECT, each aliased EXACTLY " +
          "as shown here - do NOT add GROUP BY or wrap any of them in an aggregate function; this " +
          "question has no metric/KPI, it's a plain row listing): " + dimAliases.join(", ")
      );
    } else {
      const filterFieldNames = new Set(plannerFilters.map((f) => f.field.toLowerCase()));
      const otherColumns: string[] = [];
      const pkColumns: string[] = [];
      for (const entityName of entityNames) {
        const entity = model.getEntity(entityName);
        if (!entity) continue;
        pkColumns.push(...entity.primary_keys);
        for (const dim of entity.dimensions) {
          if (!filterFieldNames.has(dim.name.toLowerCase()) && allowedColumns.has(dim.column_name.toLowerCase())) {
            otherColumns.push(dim.column_name);
          }
        }
      }
      const displayColumns = otherColumns.length ? otherColumns : pkColumns;
      const hint = displayColumns.length ? ` (e.g. ${displayColumns.map((c) => `\`${c}\``).join(", ")})` : "";
      lines.push(
        "No metric/KPI applies and no specific column was requested to display for this " +
          `listing question - SELECT the entity's own descriptive column(s)${hint}, not just an ` +
          "internal id, alongside anything the Required WHERE filters reference, so the result " +
          "still returns meaningful, identifiable rows. Do NOT add GROUP BY or any aggregate " +
          "function - there is nothing to aggregate."
      );
    }
  }

  // A top-N/bottom-N question: without this the LLM never learns the question
  // was a ranking, and returns every group with the generic row limit.
  if (resolution.sort_rank && resolution.metrics.length) {
    const { field, direction, limit } = resolution.sort_rank;
    const order = direction === "asc" ? "ASC" : "DESC";
    lines.push(
      `Required ranking: ORDER BY the aggregated "${field}" column ${order}` +
        (limit != null
          ? `, and end the query with exactly LIMIT ${limit} (this is the question's own top/bottom-${limit} ` +
            "cut-off and replaces the generic maximum row limit - never a larger number)."
          : ".")
    );
  }

  // A synthetic default filter (see below) is added here rather than to
  // `plannerFilters` itself, since that array also drives the listing
  // branch above and the allow-list, and this filter isn't part of what the
  // Resolver actually resolved - it only exists to give a period comparison
  // something to compare when the question named no date range of its own.
  const effectiveFilters = [...plannerFilters];

  if (timeBucket && shape?.trend_granularity) {
    const [, dim] = timeBucket;
    const unit = shape.trend_granularity;
    const col = `\`${dim.column_name}\``;
    const bucketAlias = unit.charAt(0).toUpperCase() + unit.slice(1);
    lines.push(
      `Required trend bucketing: this question buckets its result by ${unit}, using the time ` +
        `field '${dim.name}' (column ${col}) - NOT its raw per-row value. Add ONE more column, ` +
        "alongside any Required GROUP BY dimensions above, computed as exactly this expression " +
        `(substitute ${col} with your own table-alias-qualified reference, e.g. t0.${dim.column_name}, ` +
        `everywhere it appears): ${dateBucketExpression(col, unit)}. GROUP BY this same ` +
        `expression, alias it exactly "${bucketAlias}" in SELECT, and ORDER BY it ascending.`
    );

    if (shape.period_over_period) {
      if (!effectiveFilters.some((f) => f.field === dim.name)) {
        const [op, value] = defaultPeriodOverPeriodWindow(unit);
        effectiveFilters.push({ field: dim.name, op, value, source: "planner" });
      }
      const metric = resolution.metrics[0] ? model.resolveMetricOrMeasure(resolution.metrics[0]) : null;
      const metricAlias = metric?.name ?? "the metric";
      const partitionCols = resolution.dimensions
        .map((d) => model.findDimension(d))
        .filter((f): f is [Entity, Dimension] => f !== null)
        .map(([, d]) => `\`${d.column_name}\``);
      // The literal SQL fragment is built separately from its explanation
      // below (rather than interpolating prose into the OVER (...) example
      // itself) so nothing here could be mistaken for text to copy into the
      // window spec verbatim.
      // No breakdown dimension means one series: no PARTITION BY at all. A
      // constant placeholder such as `PARTITION BY 1` is rejected by MySQL 8
      // ("legacy position indication ... not supported").
      const partitionSql = partitionCols.length ? `PARTITION BY ${partitionCols.join(", ")}` : "";
      const partitionNote = partitionCols.length
        ? ` - here "${partitionSql}" keeps one running series per combination of the Required GROUP ` +
          "BY dimensions above, so each group's change is computed against its own previous bucket, " +
          "never a different group's"
        : " - there is no breakdown dimension, so it is one series with NO PARTITION BY clause; never " +
          "add one, and never PARTITION BY a constant such as 1 (MySQL rejects a number there as a " +
          "column position)";
      const windowSpec = `${partitionSql ? `${partitionSql} ` : ""}ORDER BY "${bucketAlias}"`;
      lines.push(
        "Required period-over-period comparison: compute this as an outer query over the bucketed " +
          "series above (wrap it in a subquery), then add a delta column using a window function - " +
          `never by joining or subquerying two separately-filtered aggregates instead. Use exactly ` +
          `this window spec: (${windowSpec})${partitionNote}. The delta ` +
          `column is this row's "${metricAlias}" value minus LAG("${metricAlias}") OVER (${windowSpec}), ` +
          `aliased "${metricAlias} Change". Optionally also add a percent-change column: (that delta / ` +
          `NULLIF(LAG("${metricAlias}") OVER (${windowSpec}), 0)) * 100, aliased "${metricAlias} % Change".`
      );
    }
  }

  if (effectiveFilters.length) {
    lines.push("Required WHERE filters (apply ALL of these, exactly, in addition to any KPI/metric logic):");
    for (const f of effectiveFilters) {
      const found = model.findDimension(f.field);
      const datatype = found ? ` [datatype: ${found[1].datatype}]` : "";
      lines.push(`  ${f.field} ${f.op} ${JSON.stringify(f.value)}${datatype}`);
    }
  }
  return lines.join("\n");
}

/**
 * Primary path: LLM-assisted generation grounded in exactly the
 * KPI/measure/dimensions/entities the Semantic Resolver found via RAG (see
 * `buildGroundingContext`) - the LLM only ever writes SQL against the real
 * tables/columns/joins/KPI rules named in that grounding, never invented
 * schema. Fallback: if the LLM call itself fails, deterministic compilation
 * straight from the semantic model (`SQLBuilder`) - the same
 * cannot-hallucinate-schema guarantee as before, just reversed from primary
 * to backstop.
 */
export class SQLAgent {
  private readonly systemPrompt: string;

  constructor(
    private readonly model: SemanticModel,
    private readonly chatModel: ChatModel,
    private readonly maxRows: number
  ) {
    this.systemPrompt = fs.readFileSync(PROMPT_PATH, "utf-8");
  }

  /**
   * `shape` is only ever consumed here for trend bucketing / period-over-
   * period grounding text (see `buildGroundingContext`) - the deterministic
   * fallback below (`SQLBuilder`) has no knowledge of either and will
   * silently compile a plain, unbucketed aggregate if it ever has to handle
   * one of these questions; that fallback path is only reached when the LLM
   * call itself fails, so this is an accepted, narrow degrade rather than a
   * silent wrong answer on the common path.
   */
  async generate(
    userQuery: string,
    resolution: SemanticResolution,
    plannerFilters: ResolvedFilter[],
    shape: QueryShapeResult | null = null
  ): Promise<GeneratedSQL> {
    try {
      return await this.generateWithLlm(userQuery, resolution, plannerFilters, shape);
    } catch (exc) {
      logger.warning("sql_llm_generation_failed_fallback_to_builder", { error: String(exc) });
      const fallback = this.tryDeterministic(resolution, plannerFilters);
      if (fallback) return fallback;
      throw exc;
    }
  }

  /** Attempts the deterministic compiler directly - used both as
   * `generate()`'s own fallback and, by the caller, as a last resort after
   * repeated LLM-repair failures. Returns null rather than throwing when the
   * shape is unsupported (e.g. multiple metrics). */
  tryDeterministic(resolution: SemanticResolution, plannerFilters: ResolvedFilter[]): GeneratedSQL | null {
    try {
      const builder = new SQLBuilder(this.model);
      const [sql, tables, columns] = builder.build(resolution, plannerFilters, this.maxRows);
      return { sql, explanation: "Generated deterministically from the semantic model.", referenced_tables: tables, referenced_columns: columns };
    } catch (exc) {
      if (exc instanceof SQLGenerationError) return null;
      throw exc;
    }
  }

  private async generateWithLlm(
    userQuery: string,
    resolution: SemanticResolution,
    plannerFilters: ResolvedFilter[],
    shape: QueryShapeResult | null
  ): Promise<GeneratedSQL> {
    const grounding = buildGroundingContext(this.model, resolution, plannerFilters, shape);
    const userPrompt = `Grounding context:\n${grounding}\n\nMaximum row limit: ${this.maxRows}\n\nUser question:\n${userQuery}`;
    const generated = await generateStructured(this.chatModel, {
      systemPrompt: this.systemPrompt,
      userPrompt,
      schema: GeneratedSQLSchema,
    });
    return { ...generated, sql: backtickAliasReferences(generated.sql) };
  }
}
