import fs from "node:fs";
import path from "node:path";
import { getLogger } from "../core/logging";
import { ExecutionResult } from "../schemas/execution";
import { makeSeries, VisualizationSpec, VisualizationSpecSchema } from "../schemas/visualization";
import { ChatModel } from "../services/llm/client";
import { generateStructured } from "../services/llm/structuredOutput";
import { ColumnProfile, profileColumns, recommendVisualization } from "../services/visualization/recommender";

const logger = getLogger("agents.visualizationAgent");
const PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "visualization.txt");

// Sample rows are for judging value shapes only - counts and ranges are
// precomputed exactly from the full result (see `profileColumns`).
const SAMPLE_ROW_LIMIT = 12;
const NON_ALNUM_RE = /[^a-z0-9]/g;

function normalize(name: string): string {
  return name.toLowerCase().replace(NON_ALNUM_RE, "");
}

/** What the question asked for and how it was answered - the chart is chosen
 * from this, not only from the result's columns. */
export interface VisualizationContext {
  userQuery: string;
  sql: string | null;
  analysisPattern: string | null;
  granularity: string | null;
  comparePrevious: boolean;
  rankLimit: number | null;
  dimensions: string[];
  metrics: string[];
}

function describeProfile(p: ColumnProfile): string {
  const range = p.kind === "number" ? `, min ${p.min}, max ${p.max}, total ${p.sum}` : "";
  const nulls = p.nulls ? `, ${p.nulls} empty` : "";
  return `\`${p.name}\` (${p.kind}, datatype ${p.datatype}, ${p.distinct} distinct${range}${nulls})`;
}

function buildGroundingContext(result: ExecutionResult, title: string, ctx: VisualizationContext): string {
  const profiles = profileColumns(result);
  const lines = [
    `User question: ${ctx.userQuery}`,
    `Analysis pattern: ${ctx.analysisPattern ?? "unknown"}` +
      (ctx.granularity ? `; time buckets: ${ctx.granularity}` : "") +
      (ctx.comparePrevious ? "; compared with the previous bucket (period over period)" : "") +
      (ctx.rankLimit ? `; ranking, top/bottom ${ctx.rankLimit}` : ""),
    `Breakdown dimensions asked for: ${ctx.dimensions.length ? ctx.dimensions.join(", ") : "none"}`,
    `Metrics computed: ${ctx.metrics.length ? ctx.metrics.join(", ") : "none (plain listing)"}`,
    ctx.sql ? `Executed SQL (for understanding the result's shape only):\n${ctx.sql}` : "",
    "Result columns, profiled over ALL rows (use these EXACT names, case-sensitive, for every " +
      "x_axis/y_axis/group_by/series field):\n  " +
      profiles.map(describeProfile).join("\n  "),
    `Row count: ${result.row_count}` + (result.truncated ? " (truncated - more rows exist than were returned)" : ""),
    `Suggested overall title: ${JSON.stringify(title)}`,
    `Sample rows (first ${Math.min(SAMPLE_ROW_LIMIT, result.rows.length)}, for value shapes only): ` +
      JSON.stringify(result.rows.slice(0, SAMPLE_ROW_LIMIT)),
  ];
  return lines.filter(Boolean).join("\n");
}

const NEEDS_AXES = new Set(["line", "area", "stacked_area", "bar", "horizontal_bar", "grouped_bar", "stacked_bar", "combo", "scatter", "pie", "donut", "radar", "radial_bar", "funnel", "treemap", "heatmap"]);

/**
 * Keeps a model-chosen spec only where it points at real result columns:
 * fixes re-cased/re-spaced names, drops series and splits that don't exist,
 * and drops any chart left with nothing to plot. Null when nothing usable
 * remains.
 */
export function sanitizeSpec(spec: VisualizationSpec, columns: string[]): VisualizationSpec | null {
  const byNorm = new Map(columns.map((c) => [normalize(c), c]));
  const fix = (name: string | null | undefined): string | null => (name ? (byNorm.get(normalize(name)) ?? null) : null);

  if (spec.type === "multi_chart") {
    const charts = spec.charts.map((c) => sanitizeSpec(c, columns)).filter((c): c is VisualizationSpec => c !== null && c.type !== "multi_chart");
    if (!charts.length) return null;
    return charts.length === 1 ? { ...charts[0], title: charts[0].title || spec.title } : { ...spec, charts };
  }
  if (!NEEDS_AXES.has(spec.type)) return { ...spec, charts: [] };

  const series = spec.series
    .map((s) => ({ ...makeSeries(s.field, s.label), ...s, field: fix(s.field) }))
    .filter((s): s is typeof s & { field: string } => s.field !== null);
  const x = fix(spec.x_axis);
  const specY = fix(spec.y_axis) ?? series[0]?.field ?? null;
  // The value axis can never be the category axis itself.
  const y = specY !== x ? specY : (series.find((s) => s.field !== x)?.field ?? null);
  if (!x || !y) return null;
  const groupBy = fix(spec.group_by);
  return {
    ...spec,
    x_axis: x,
    y_axis: y,
    group_by: groupBy && groupBy !== x ? groupBy : null,
    series: series.length ? series : [makeSeries(y)],
    charts: [],
  };
}

/**
 * Chooses the chart(s) for a result from the question, the executed query and
 * the result's own columns. Any chart type the frontend can draw is allowed,
 * and several charts may be returned when they show genuinely different views.
 * Falls back to the deterministic recommender when the model call fails or
 * its answer names no usable columns.
 */
export class VisualizationAgent {
  private readonly systemPrompt: string;

  constructor(private readonly chatModel: ChatModel) {
    this.systemPrompt = fs.readFileSync(PROMPT_PATH, "utf-8");
  }

  async recommend(result: ExecutionResult, title: string, ctx: VisualizationContext): Promise<VisualizationSpec> {
    const fallback = recommendVisualization(result, title);
    if (!result.rows.length) return fallback;
    const columns = result.columns.length ? result.columns.map((c) => c.name) : Object.keys(result.rows[0]);
    try {
      const userPrompt = buildGroundingContext(result, title, ctx);
      const spec = await generateStructured(this.chatModel, { systemPrompt: this.systemPrompt, userPrompt, schema: VisualizationSpecSchema });
      const clean = sanitizeSpec(spec, columns);
      if (clean) return clean;
      logger.warning("visualization_spec_unusable_fallback_to_recommender", { spec });
    } catch (exc) {
      logger.warning("visualization_llm_failed_fallback_to_recommender", { error: String(exc) });
    }
    return fallback;
  }
}
