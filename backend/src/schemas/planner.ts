import { z } from "zod";

/**
 * The Planner's single structured reading of a question: whether it can be
 * answered, what is being measured (`subject`), how it is computed, and the
 * breakdowns/filters/time it names - all in the question's own words. The
 * Planner never sees the semantic catalog: each part is matched against it
 * later by the Resolver's similarity search, part by part.
 *
 * Kept flat (no nested objects beyond `time`) and with defaults on every
 * field, so a small model can fill it reliably.
 */
export const TIME_GRANULARITIES = ["day", "week", "month", "quarter", "year"] as const;
export type TimeGranularity = (typeof TIME_GRANULARITIES)[number];

export const PlannerTimeSchema = z.object({
  /** The period exactly as worded ("nov 2025", "last quarter"), or null. */
  phrase: z.string().nullable().default(null),
  /** The business date it applies to, named after the verb ("Resolved Date"). */
  field: z.string().nullable().default(null),
  /** Bucketing unit for a trend ("weekly", "by month", "week over week"). */
  granularity: z.enum(TIME_GRANULARITIES).nullable().default(null),
  /** True when the change between consecutive buckets is wanted (WoW, MoM, YoY...). */
  compare_previous: z.boolean().default(false),
});
export type PlannerTime = z.infer<typeof PlannerTimeSchema>;

export const PlannerResultSchema = z.object({
  intent: z.enum(["analytics_query", "clarification_needed", "unsupported"]).default("analytics_query"),
  // Shown to the user verbatim when intent is not "analytics_query". Empty otherwise.
  reason: z.string().default(""),
  // What is measured or listed, without any time, grouping or filter words.
  subject: z.string().default(""),
  analysis_pattern: z
    .enum(["single_value", "aggregation", "breakdown", "trend", "ranking", "comparison", "list"])
    .default("single_value"),
  // Non-time grouping attributes ("by priority" -> ["priority"]).
  dimensions: z.array(z.string()).default([]),
  // Non-time conditions: {"field in the question's words": value}.
  filters: z.record(z.any()).default({}),
  time: PlannerTimeSchema.default({}),
  rank_limit: z.number().int().nullable().default(null),
  rank_direction: z.enum(["asc", "desc"]).default("desc"),
});
export type PlannerResult = z.infer<typeof PlannerResultSchema>;

/** A planned time period turned into a concrete range by code (never by the
 * model), e.g. "nov 2025" -> between 2025-11-01 and 2025-11-30. */
export interface ResolvedTimeRange {
  op: string;
  value: unknown;
}

/** The planner's result after code-side checks, as stored on the agent state. */
export interface Plan extends PlannerResult {
  /** The concrete range for `time.phrase`, or null when none / unparseable. */
  time_range: ResolvedTimeRange | null;
  /** Search text for the semantic catalog: `subject`, or a fallback. */
  retrieval_query: string;
  /** The question's own wording with periods, groupings and ranking words
   * removed in code. The model's `subject` often drops the qualifier that
   * names a KPI ("unique", "received"), so KPI/metric matching also searches
   * with this text and keeps the better score. */
  measure_text: string;
}
