import { z } from "zod";

export const SeriesSpecSchema = z.object({
  field: z.string(),
  label: z.string(),
  // Only read by "combo" charts: how this one series is drawn, and which value
  // axis it is measured against (e.g. a count as bars on the left, its
  // % change as a line on the right).
  render: z.enum(["bar", "line", "area"]).nullable().default(null),
  axis: z.enum(["left", "right"]).nullable().default(null),
});
export type SeriesSpec = z.infer<typeof SeriesSpecSchema>;

export const VisualizationTypeSchema = z.enum([
  "line",
  "area",
  "stacked_area",
  "bar",
  "horizontal_bar",
  "grouped_bar",
  "stacked_bar",
  "combo",
  "scatter",
  "pie",
  "donut",
  "radar",
  "radial_bar",
  "funnel",
  "treemap",
  "heatmap",
  "table",
  "kpi_card",
  "multi_chart",
]);
export type VisualizationType = z.infer<typeof VisualizationTypeSchema>;

export interface VisualizationSpec {
  type: VisualizationType;
  title: string;
  /** One short line on what this chart shows, displayed under its title. */
  description?: string | null;
  x_axis?: string | null;
  y_axis?: string | null;
  /** Splits the rows into one series per value of this column (grouped /
   * stacked bars, stacked areas, multi-line, 2-D heatmap rows). */
  group_by?: string | null;
  series: SeriesSpec[];
  /** Only set when type == "multi_chart": several charts, each a different
   * view of the same result (e.g. the trend plus its period-over-period
   * change, or one chart per breakdown dimension). */
  charts: VisualizationSpec[];
}

// Permissive `any` Input parameter - see FilterGroupSchema's comment for why.
export const VisualizationSpecSchema: z.ZodType<VisualizationSpec, z.ZodTypeDef, any> = z.lazy(() =>
  z.object({
    type: VisualizationTypeSchema,
    title: z.string(),
    description: z.string().nullable().default(null),
    x_axis: z.string().nullable().default(null),
    y_axis: z.string().nullable().default(null),
    group_by: z.string().nullable().default(null),
    series: z.array(SeriesSpecSchema).default([]),
    charts: z.array(VisualizationSpecSchema).default([]),
  })
);

export function makeVisualizationSpec(partial: Partial<VisualizationSpec> & Pick<VisualizationSpec, "type" | "title">): VisualizationSpec {
  return {
    description: null,
    x_axis: null,
    y_axis: null,
    group_by: null,
    series: [],
    charts: [],
    ...partial,
  };
}

export function makeSeries(field: string, label = field, extra: Partial<SeriesSpec> = {}): SeriesSpec {
  return { field, label, render: null, axis: null, ...extra };
}
