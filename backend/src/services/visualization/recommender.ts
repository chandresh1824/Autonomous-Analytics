import { ExecutionResult } from "../../schemas/execution";
import { makeSeries, makeVisualizationSpec, VisualizationSpec, VisualizationType } from "../../schemas/visualization";

/** The SQL Agent aliases a time bucket exactly like this (see sqlAgent.ts). */
export const TIME_BUCKET_COLUMN_RE = /^(?:day|week|month|quarter|year)$/i;
/** Period-over-period delta columns ("<metric> Change", "<metric> % Change"). */
export const CHANGE_COLUMN_RE = /\bchange$/i;
const DATE_VALUE_RE = /^\d{4}-\d{2}-\d{2}/;
const DATE_NAME_RE = /date|time|(?:^|_|\s)at$|day|week|month|quarter|year/i;

// Distributions this small (e.g. yes/no) read better as a share-of-total.
const PIE_MAX_CATEGORIES = 5;
// Up to this many categories still read as individual vertical bars.
const BAR_MAX_CATEGORIES = 12;
// Up to this many as horizontal bars (long labels, ranked lists).
const HBAR_MAX_CATEGORIES = 30;

export interface ColumnProfile {
  name: string;
  datatype: string;
  kind: "time" | "number" | "category";
  distinct: number;
  nulls: number;
  min?: number;
  max?: number;
  sum?: number;
}

function isNumeric(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "bigint") return true;
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) && !DATE_VALUE_RE.test(value);
}

function isDateLike(value: unknown): boolean {
  return value instanceof Date || (typeof value === "string" && DATE_VALUE_RE.test(value));
}

/** One profile per result column, computed over ALL rows: what kind of
 * values it holds and, for numbers, their range and total. */
export function profileColumns(result: ExecutionResult): ColumnProfile[] {
  const names = result.columns.length ? result.columns.map((c) => c.name) : Object.keys(result.rows[0] ?? {});
  const datatypes = new Map(result.columns.map((c) => [c.name, c.datatype]));
  return names.map((name) => {
    const values = result.rows.map((r) => r[name]);
    const present = values.filter((v) => v !== null && v !== undefined);
    const datatype = datatypes.get(name) ?? "unknown";
    const numeric = present.length > 0 && present.every(isNumeric);
    const time =
      TIME_BUCKET_COLUMN_RE.test(name) ||
      /date|time/i.test(datatype) ||
      (present.length > 0 && present.every(isDateLike) && DATE_NAME_RE.test(name));
    const profile: ColumnProfile = {
      name,
      datatype,
      kind: time ? "time" : numeric ? "number" : "category",
      distinct: new Set(values.map((v) => (v instanceof Date ? v.toISOString() : String(v)))).size,
      nulls: values.length - present.length,
    };
    if (profile.kind === "number") {
      const nums = present.map(Number);
      profile.min = Math.min(...nums);
      profile.max = Math.max(...nums);
      profile.sum = nums.reduce((a, b) => a + b, 0);
    }
    return profile;
  });
}

function categoryChartType(distinct: number, allPositive: boolean): VisualizationType {
  if (distinct <= PIE_MAX_CATEGORIES && allPositive) return "donut";
  if (distinct <= BAR_MAX_CATEGORIES) return "bar";
  if (distinct <= HBAR_MAX_CATEGORIES) return "horizontal_bar";
  return "treemap";
}

/**
 * Deterministic chart choice, used when the Visualization Agent's model call
 * fails or returns nothing usable. Reads only the result's own columns, so it
 * works for any query shape - trends, period-over-period, breakdowns, rankings
 * and plain listings.
 */
export function recommendVisualization(result: ExecutionResult, title: string): VisualizationSpec {
  if (!result.rows.length) return makeVisualizationSpec({ type: "table", title });

  const profiles = profileColumns(result);
  const time = profiles.find((p) => p.kind === "time");
  const categories = profiles.filter((p) => p.kind === "category");
  const numbers = profiles.filter((p) => p.kind === "number");
  const values = numbers.filter((p) => !CHANGE_COLUMN_RE.test(p.name));
  const changes = numbers.filter((p) => CHANGE_COLUMN_RE.test(p.name));
  const primary = values[0] ?? numbers[0];

  if (!primary) return makeVisualizationSpec({ type: "table", title });
  if (result.rows.length === 1) return makeVisualizationSpec({ type: "kpi_card", title });

  // A time series, possibly split by one category and/or carrying its change.
  if (time && time.distinct > 1) {
    const split = categories.find((c) => c.distinct > 1 && c.distinct <= BAR_MAX_CATEGORIES);
    if (split) {
      return makeVisualizationSpec({
        type: "line",
        title,
        x_axis: time.name,
        y_axis: primary.name,
        group_by: split.name,
        series: [makeSeries(primary.name)],
      });
    }
    const trend = makeVisualizationSpec({
      type: "line",
      title,
      x_axis: time.name,
      y_axis: primary.name,
      series: values.slice(0, 4).map((v) => makeSeries(v.name)),
    });
    const absChange = changes.find((c) => !c.name.includes("%")) ?? changes[0];
    if (!absChange) return trend;
    return makeVisualizationSpec({
      type: "multi_chart",
      title,
      charts: [
        { ...trend, title: primary.name },
        makeVisualizationSpec({
          type: "bar",
          title: absChange.name,
          description: "Change from the previous period",
          x_axis: time.name,
          y_axis: absChange.name,
          series: [makeSeries(absChange.name)],
        }),
      ],
    });
  }

  const allPositive = (primary.min ?? 0) >= 0;
  const groupable = categories.filter((c) => c.distinct > 1);

  if (groupable.length >= 2) {
    const [a, b] = groupable;
    if (a.distinct <= BAR_MAX_CATEGORIES && b.distinct <= BAR_MAX_CATEGORIES) {
      return makeVisualizationSpec({
        type: "stacked_bar",
        title,
        x_axis: a.name,
        y_axis: primary.name,
        group_by: b.name,
        series: [makeSeries(primary.name)],
      });
    }
    return makeVisualizationSpec({ type: "heatmap", title, x_axis: a.name, y_axis: primary.name, group_by: b.name, series: [makeSeries(primary.name)] });
  }

  if (groupable.length === 1) {
    const dim = groupable[0];
    if (values.length > 1 && dim.distinct <= BAR_MAX_CATEGORIES) {
      return makeVisualizationSpec({ type: "grouped_bar", title, x_axis: dim.name, y_axis: primary.name, series: values.slice(0, 6).map((v) => makeSeries(v.name)) });
    }
    return makeVisualizationSpec({
      type: categoryChartType(dim.distinct, allPositive),
      title,
      x_axis: dim.name,
      y_axis: primary.name,
      series: [makeSeries(primary.name)],
    });
  }

  // Only numbers: two of them plot against each other.
  if (numbers.length >= 2 && result.rows.length > 2) {
    return makeVisualizationSpec({ type: "scatter", title, x_axis: numbers[0].name, y_axis: numbers[1].name, series: [makeSeries(numbers[1].name)] });
  }
  return makeVisualizationSpec({ type: "table", title });
}
