import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getLogger } from "../core/logging";
import { ExecutionResult } from "../schemas/execution";
import { ChatModel } from "../services/llm/client";
import { generateStructured } from "../services/llm/structuredOutput";
import { CHANGE_COLUMN_RE, profileColumns } from "../services/visualization/recommender";

const logger = getLogger("agents.responseAgent");
const PROMPT_PATH = path.resolve(__dirname, "..", "prompts", "response.txt");
const NON_ALNUM_RE = /[^a-z0-9]/g;

function normalize(name: string): string {
  return name.toLowerCase().replace(NON_ALNUM_RE, "");
}

function matchResultColumn(name: string, resultColumns: string[]): string | null {
  const target = normalize(name);
  for (const col of resultColumns) if (normalize(col) === target) return col;
  return null;
}

function computeMetricTotal(kpiOrMetric: string, dimensions: string[], result: ExecutionResult): number | null {
  const resultColumns = result.columns.length ? result.columns.map((c) => c.name) : Object.keys(result.rows[0] ?? {});
  let metricColumn = matchResultColumn(kpiOrMetric, resultColumns);
  if (metricColumn === null) {
    const candidates = resultColumns.filter((c) => !dimensions.includes(c));
    metricColumn = candidates.length ? candidates[0] : null;
  }
  if (metricColumn === null) return null;
  try {
    let total = 0;
    for (const row of result.rows) {
      const value = row[metricColumn];
      const num = Number(value ?? 0);
      if (Number.isNaN(num)) return null;
      total += num;
    }
    return total;
  } catch {
    return null;
  }
}

const TIME_BUCKET_COLUMN_RE = /^(?:day|week|month|quarter|year)$/i;
const MAX_GROUPS_LISTED = 8;
const MAX_DISTINCT_VALUES = 40;

/**
 * Exact per-category totals of the metric for every grouping column, computed
 * over ALL rows. The model only sees a 20-row sample, and it has been seen
 * inventing sums/percentages from that sample (e.g. "High priority = 99.1% of
 * the volume" when it is 23%); giving it the real totals - with shares -
 * removes any need to add things up itself.
 */
export function groupTotalsNote(kpiOrMetric: string, dimensions: string[], result: ExecutionResult): string {
  const columns = result.columns.length ? result.columns.map((c) => c.name) : Object.keys(result.rows[0] ?? {});
  const metricColumn = matchResultColumn(kpiOrMetric, columns) ?? columns.find((c) => !dimensions.includes(c)) ?? null;
  if (metricColumn === null) return "";
  const grand = result.rows.reduce((sum, row) => sum + (Number(row[metricColumn]) || 0), 0);
  if (!(grand > 0)) return "";

  const lines: string[] = [];
  for (const column of columns) {
    if (column === metricColumn || TIME_BUCKET_COLUMN_RE.test(column) || /change/i.test(column)) continue;
    const totals = new Map<string, number>();
    for (const row of result.rows) {
      const key = row[column] === null || row[column] === undefined ? "(blank)" : String(row[column]);
      totals.set(key, (totals.get(key) ?? 0) + (Number(row[metricColumn]) || 0));
    }
    if (totals.size < 2 || totals.size > MAX_DISTINCT_VALUES) continue;
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const listed = sorted
      .slice(0, MAX_GROUPS_LISTED)
      .map(([key, value]) => `${key} ${Math.round(value).toLocaleString()} (${((value / grand) * 100).toFixed(1)}%)`)
      .join("; ");
    const more = sorted.length > MAX_GROUPS_LISTED ? `; +${sorted.length - MAX_GROUPS_LISTED} more` : "";
    lines.push(`  by ${column}: ${listed}${more}`);
  }
  return lines.length
    ? "Exact totals per category over ALL rows, largest first (quote these for any category total or share - never add up the sample rows yourself):\n" +
        lines.join("\n") +
        "\n"
    : "";
}

/**
 * Exact highest/lowest value of each measure with the row it belongs to, and
 * for a time series its first and last bucket - computed over ALL rows so the
 * highlights never rest on the model scanning a sample.
 */
export function extremesNote(result: ExecutionResult): string {
  if (result.rows.length < 2) return "";
  const profiles = profileColumns(result);
  const label = profiles.find((p) => p.kind === "time") ?? profiles.find((p) => p.kind === "category");
  if (!label) return "";
  const show = (row: Record<string, unknown>): string => String(row[label.name] ?? "(blank)");
  const lines: string[] = [];
  for (const p of profiles) {
    if (p.kind !== "number") continue;
    const rows = result.rows.filter((r) => r[p.name] !== null && r[p.name] !== undefined);
    if (rows.length < 2) continue;
    const num = (r: Record<string, unknown>) => Number(r[p.name]);
    const hi = rows.reduce((a, b) => (num(b) > num(a) ? b : a));
    const lo = rows.reduce((a, b) => (num(b) < num(a) ? b : a));
    let line = `  ${p.name}: highest ${num(hi).toLocaleString()} (${show(hi)}), lowest ${num(lo).toLocaleString()} (${show(lo)})`;
    if (label.kind === "time" && !CHANGE_COLUMN_RE.test(p.name)) {
      const first = rows[0];
      const last = rows[rows.length - 1];
      line += `, first ${num(first).toLocaleString()} (${show(first)}), last ${num(last).toLocaleString()} (${show(last)})`;
      line += `, average ${(p.sum! / rows.length).toLocaleString(undefined, { maximumFractionDigits: 1 })} per ${label.name.toLowerCase()}`;
    }
    lines.push(line);
  }
  return lines.length ? `Exact extremes over ALL rows (by ${label.name}):\n${lines.join("\n")}\n` : "";
}

/** How the question was analysed - lets the summary name the period and
 * frame trends/comparisons correctly. */
export interface ResponseContext {
  period: string | null;
  analysisPattern: string | null;
  granularity: string | null;
  comparePrevious: boolean;
}

// Small results are given to the model whole; larger ones as a sample.
const FULL_RESULT_MAX_ROWS = 60;
const SAMPLE_ROWS = 30;

export const ResponsePayloadSchema = z.object({
  summary: z.string(),
  insights: z.array(z.string()).default([]),
});
export type ResponsePayload = z.infer<typeof ResponsePayloadSchema>;

/**
 * Turns the execution result into a business-friendly answer. Never exposes
 * SQL, table/column names or chain-of-thought - only the final summary and
 * grounded insights.
 */
export class ResponseAgent {
  private readonly systemPrompt: string;

  constructor(private readonly chatModel: ChatModel) {
    this.systemPrompt = fs.readFileSync(PROMPT_PATH, "utf-8");
  }

  /** `emptyResultNote` explains an empty result when the pipeline could work
   * out why (e.g. the question's period is past the end of the data). */
  async respond(
    userQuery: string,
    kpiOrMetric: string,
    dimensions: string[],
    result: ExecutionResult,
    emptyResultNote: string | null = null,
    rankLimit: number | null = null,
    context: ResponseContext | null = null
  ): Promise<ResponsePayload> {
    if (!result.rows.length) {
      return { summary: emptyResultNote || "The query returned no results for the selected filters.", insights: [] };
    }

    // A NULL grouping value is a real group (records with no value for that
    // attribute) - shown to the model as "(blank)" so it is described as such
    // instead of being called "missing" or "not identifiable".
    const sampleRows = result.rows
      .slice(0, result.rows.length <= FULL_RESULT_MAX_ROWS ? FULL_RESULT_MAX_ROWS : SAMPLE_ROWS)
      .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? "(blank)" : v])));
    const total = computeMetricTotal(kpiOrMetric, dimensions, result);
    const rankNote =
      rankLimit !== null
        ? `Ranking: the rows are ONLY the top ${rankLimit} groups, already ordered best-first - not every group. ` +
          `The precomputed total covers just these ${result.row_count} rows, so call it "the top ${rankLimit} combined" ` +
          "and never the total across all groups. Name the groups in the order given (first row = highest). " +
          "\"(blank)\" is a real group of records with no value for that attribute - describe it as blank/unassigned.\n"
        : "";
    const userPrompt =
      `User question: ${userQuery}\n` +
      `KPI/metric computed: ${kpiOrMetric}\n` +
      `Dimensions: ${JSON.stringify(dimensions)}\n` +
      (context?.period ? `Period covered: ${context.period}\n` : "") +
      (context?.analysisPattern
        ? `Analysis: ${context.analysisPattern}` +
          (context.granularity ? `, by ${context.granularity}` : "") +
          (context.comparePrevious ? `, each ${context.granularity ?? "period"} compared with the previous one` : "") +
          "\n"
        : "") +
      `Row count: ${result.row_count} (breakdown row/category count - never the ${kpiOrMetric} value)\n` +
      rankNote +
      (total !== null ? `Precomputed total ${kpiOrMetric} across all rows: ${Math.round(total).toLocaleString()}\n` : "") +
      groupTotalsNote(kpiOrMetric, dimensions, result) +
      extremesNote(result) +
      (result.row_count > sampleRows.length
        ? `Sample rows (first ${sampleRows.length} of ${result.row_count} - NOT the full result): `
        : `All ${sampleRows.length} result rows: `) +
      JSON.stringify(sampleRows);
    try {
      return await generateStructured(this.chatModel, { systemPrompt: this.systemPrompt, userPrompt, schema: ResponsePayloadSchema });
    } catch (exc) {
      logger.warning("response_agent_llm_failed", { error: String(exc) });
      return this.fallbackSummary(kpiOrMetric, result, total);
    }
  }

  private fallbackSummary(kpiOrMetric: string, result: ExecutionResult, total: number | null): ResponsePayload {
    const summary =
      total !== null
        ? `There were ${Math.round(total).toLocaleString()} total for ${kpiOrMetric} across ${result.row_count} row(s).`
        : `Returned ${result.row_count} row(s) for ${kpiOrMetric}.`;
    return { summary, insights: [] };
  }
}
