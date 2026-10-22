import fs from "node:fs";
import { ZodError } from "zod";
import { SemanticModelError } from "../../core/exceptions";
import { SemanticModel, SemanticModelDataSchema } from "../../schemas/semantic";

export function parseSemanticModelDict(raw: unknown): SemanticModel {
  try {
    const data = SemanticModelDataSchema.parse(raw);
    return new SemanticModel(data);
  } catch (exc) {
    if (exc instanceof ZodError) {
      throw new SemanticModelError(`Semantic model failed validation: ${exc.message}`);
    }
    if (exc instanceof SemanticModelError) throw exc;
    throw new SemanticModelError(`Semantic model failed validation: ${String(exc)}`);
  }
}

export function parseSemanticModelFile(filePath: string): SemanticModel {
  if (!fs.existsSync(filePath)) {
    throw new SemanticModelError(`Semantic model file not found at ${filePath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (exc) {
    throw new SemanticModelError(`Semantic model file is not valid JSON: ${String(exc)}`);
  }
  return parseSemanticModelDict(raw);
}
