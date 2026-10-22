import { z } from "zod";

export const ColumnMetaSchema = z.object({
  name: z.string(),
  datatype: z.string().default("unknown"),
});
export type ColumnMeta = z.infer<typeof ColumnMetaSchema>;

export const ExecutionResultSchema = z.object({
  columns: z.array(ColumnMetaSchema).default([]),
  rows: z.array(z.record(z.any())).default([]),
  row_count: z.number().default(0),
  execution_time_ms: z.number().default(0),
  truncated: z.boolean().default(false),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
