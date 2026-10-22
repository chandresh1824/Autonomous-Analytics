import { z } from "zod";
import { KPISchema } from "./semantic";

export const KPICreateSchema = KPISchema;
export const KPIUpdateSchema = KPISchema;

export const KPIValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type KPIValidationResult = z.infer<typeof KPIValidationResultSchema>;
