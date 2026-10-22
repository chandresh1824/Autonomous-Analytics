import { z } from "zod";
import { VisualizationSpecSchema } from "./visualization";

/**
 * A pinned widget stores a point-in-time snapshot of a chat response (its
 * summary/insights/chart/table/SQL) rather than a live query - pinning a
 * question is meant to save the exact insight the user saw, the same way a
 * screenshot would, without re-running the underlying query (and its LLM
 * calls) every time the dashboard is opened.
 */
export const PinnedWidgetCreateSchema = z.object({
  title: z.string().trim().default(""),
  question: z.string().trim().min(1, "question is required"),
  conversation_id: z.string().nullable().default(null),
  message_id: z.string().nullable().default(null),
  summary: z.string().default(""),
  insights: z.array(z.string()).default([]),
  visualization: VisualizationSpecSchema.nullable().default(null),
  table: z
    .object({ columns: z.array(z.string()).default([]), rows: z.array(z.record(z.any())).default([]) })
    .nullable()
    .default(null),
  metadata: z
    .object({
      kpis: z.array(z.string()).default([]),
      metrics: z.array(z.string()).default([]),
      dimensions: z.array(z.string()).default([]),
      execution_time_ms: z.number().default(0),
      total_time_ms: z.number().default(0),
      row_count: z.number().default(0),
    })
    .default({}),
  sql: z.object({ query: z.string(), visible: z.boolean().default(true) }).nullable().default(null),
});
export type PinnedWidgetCreate = z.infer<typeof PinnedWidgetCreateSchema>;

/** The user's dashboard order, first widget first. */
export const PinnedWidgetOrderSchema = z.object({ ids: z.array(z.string().min(1)).max(500) });

export interface PinnedWidgetSnapshot {
  summary: string;
  insights: string[];
  visualization: unknown | null;
  table: { columns: string[]; rows: Record<string, unknown>[] } | null;
  metadata: {
    kpis: string[];
    metrics: string[];
    dimensions: string[];
    execution_time_ms: number;
    total_time_ms?: number;
    row_count: number;
  };
  sql: { query: string; visible: boolean } | null;
}

export interface PinnedWidgetOut extends PinnedWidgetSnapshot {
  id: string;
  title: string;
  question: string;
  conversation_id: string | null;
  message_id: string | null;
  created_at: string;
}
