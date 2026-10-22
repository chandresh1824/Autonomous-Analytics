import type { TableData, VisualizationSpec } from '@/types/api';

// CSS custom properties, for use in plain HTML/CSS contexts (legend swatches, etc).
export const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
];

// Raw hex equivalents (must be kept in sync with styles/variables.css), for use
// as Recharts SVG fill/stroke props where CSS var() resolution is unreliable
// across renderers.
export const CHART_COLOR_HEX = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
];

/**
 * Pivots flat table rows into a shape Recharts can consume for grouped
 * (multi-series) bar/line charts: one row per x-axis value, with one key
 * per distinct group_by value holding the y-axis metric for that group.
 */
export function pivotForGrouping(
  table: TableData,
  xAxis: string,
  yAxis: string,
  groupBy: string,
): { data: Record<string, unknown>[]; groupKeys: string[] } {
  const groupKeysSet = new Set<string>();
  const byX = new Map<string, Record<string, unknown>>();

  for (const row of table.rows) {
    const xValue = String(row[xAxis] ?? '');
    const groupValue = String(row[groupBy] ?? 'Unknown');
    groupKeysSet.add(groupValue);

    const existing = byX.get(xValue) ?? { [xAxis]: row[xAxis] ?? xValue };
    existing[groupValue] = row[yAxis];
    byX.set(xValue, existing);
  }

  return {
    data: Array.from(byX.values()),
    groupKeys: Array.from(groupKeysSet.values()),
  };
}

/**
 * Collapses flat multi-dimension result rows down to one row per value of a
 * single dimension, summing each measure across every other dimension in the
 * row (e.g. a result grouped by Priority + Service Line becomes one row per
 * Priority, with the measures summed over all its service lines). Summing is
 * the only generically correct way to combine rows here without re-querying:
 * it's exact for additive measures (counts, sums) and is what per-dimension
 * breakout charts need.
 */
export function aggregateByDimension(table: TableData, dim: string, measures: string | string[]): TableData {
  const fields = Array.isArray(measures) ? measures : [measures];
  const totals = new Map<string, Record<string, number>>();
  const order: string[] = [];

  for (const row of table.rows) {
    const key = String(row[dim] ?? 'Unknown');
    if (!totals.has(key)) {
      order.push(key);
      totals.set(key, Object.fromEntries(fields.map((f) => [f, 0])));
    }
    const sums = totals.get(key)!;
    for (const f of fields) {
      const value = Number(row[f]);
      sums[f] += Number.isFinite(value) ? value : 0;
    }
  }

  return {
    columns: [dim, ...fields],
    rows: order.map((key) => ({ [dim]: key, ...totals.get(key) })),
  };
}

/**
 * Determines usable x/y fields for a chart, falling back to sensible
 * defaults from the table columns when the visualization spec omits them -
 * or when it names a field that isn't actually one of the table's columns.
 * The backend recommends axes from the resolved dimension/metric's semantic
 * name, but the query that actually ran can alias a column differently, or
 * drop a requested dimension entirely; trusting spec.x_axis/y_axis without
 * checking produces a chart plotting a field that doesn't exist in any row -
 * effectively blank. Returns null fields when nothing usable can be found at
 * all, so the caller can fall back to a plain table instead of rendering a
 * broken chart.
 */
export function resolveAxes(
  spec: VisualizationSpec,
  table: TableData,
): { x: string | null; y: string | null } {
  const columns = table.columns;
  const hasColumn = (name: string | null | undefined): name is string =>
    !!name && columns.includes(name);
  const numericColumn = columns.find((c) => table.rows.some((r) => typeof r[c] === 'number'));

  const x = hasColumn(spec.x_axis) ? spec.x_axis : columns.find((c) => c !== numericColumn) ?? columns[0] ?? null;
  const specY = hasColumn(spec.y_axis) ? spec.y_axis : hasColumn(spec.series[0]?.field) ? spec.series[0].field : null;
  const y = specY ?? numericColumn ?? columns[columns.length - 1] ?? null;
  return { x: x ?? null, y: y ?? null };
}
