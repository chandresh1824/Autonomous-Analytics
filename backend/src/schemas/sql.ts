import { z } from "zod";

export const SQLValidationResultSchema = z.object({
  valid: z.boolean(),
  sql: z.string(),
  errors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type SQLValidationResult = z.infer<typeof SQLValidationResultSchema>;

export const GeneratedSQLSchema = z.object({
  sql: z.string(),
  explanation: z.string().default(""),
  referenced_tables: z.array(z.string()).default([]),
  referenced_columns: z.array(z.string()).default([]),
});
export type GeneratedSQL = z.infer<typeof GeneratedSQLSchema>;
