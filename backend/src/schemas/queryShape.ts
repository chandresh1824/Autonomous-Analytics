import { z } from "zod";

/**
 * Judges the shape of computation a question needs (analysis_pattern) and
 * extracts its breakdown/grouping and filter phrases, in the question's own
 * wording - never required to match the catalog's exact spelling. See the
 * Python `QueryShapeResult`'s docstring for the full rationale of why this
 * stays a separate LLM call from the Planner's.
 */
export const QueryShapeResultSchema = z.object({
  analysis_pattern: z
    .enum(["aggregation", "trend", "ranking", "comparison", "breakdown", "single_value", "list"])
    .default("aggregation"),
  rank_limit: z.number().int().nullable().default(null),
  rank_direction: z.enum(["asc", "desc"]).default("desc"),
  dimensions: z.array(z.string()).default([]),
  filters: z.record(z.any()).default({}),
  /**
   * Set whenever the question names a time-bucketing unit - either a plain
   * trend ("weekly volumes", "by month") or a period-over-period comparison
   * ("week over week", "MoM", "vs last quarter"). Never resolved against the
   * literal dimension catalog (there is no dimension named "week") - the
   * Resolver instead buckets whichever time field the matched KPI/metric
   * itself already uses. null when the question names no bucketing unit.
   */
  trend_granularity: z.enum(["day", "week", "month", "quarter", "year"]).nullable().default(null),
  /**
   * True when the question wants the delta/growth between consecutive
   * buckets of `trend_granularity` - "week over week", "WoW", "MoM", "QoQ",
   * "YoY", "vs last month", or a difference word (difference/drop/bump/
   * jump/lift/change) tied to a period. False for a plain bucketed trend
   * with no comparison ("weekly volumes for Q4 2025"). Meaningless (and
   * always false) when `trend_granularity` is null.
   */
  period_over_period: z.boolean().default(false),
});
export type QueryShapeResult = z.infer<typeof QueryShapeResultSchema>;
