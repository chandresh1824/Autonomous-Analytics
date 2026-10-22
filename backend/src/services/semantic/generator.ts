import { z } from "zod";
import { getLogger } from "../../core/logging";
import { ChatModel } from "../llm/client";
import { generateStructured } from "../llm/structuredOutput";
import { DimensionSchema, Entity, MeasureSchema, SemanticModel, SemanticModelData } from "../../schemas/semantic";

const logger = getLogger("services.semantic.generator");

/** Columns classified per LLM call - see `generateEntityDraft`. */
const DEFAULT_COLUMN_BATCH_SIZE = 6;

const RELATIONSHIP_SYSTEM_PROMPT =
  "You are a data modeling assistant. Given a set of database tables and their column names " +
  "(no foreign keys are declared for any of them - if they were, you would not be asked), " +
  "propose the relationships you can infer from naming patterns alone (e.g. a column like " +
  "`user_id` or `assigned_to` on one table plausibly referencing another table's identifying " +
  "column, or a table name embedded in a column name). Only propose a relationship between two " +
  "tables that both actually appear in the input - never invent a table. Only propose a " +
  "relationship you have reasonable naming evidence for; if nothing plausible connects two " +
  "tables, do not force a guess between them. Each suggestion needs a short reason explaining " +
  "the naming evidence, since these are unverified guesses a human will review before saving, " +
  "never applied automatically.";

const SYNONYM_SYSTEM_PROMPT =
  "You are a data modeling assistant writing business synonyms for one field of an analytics " +
  "semantic model. Given the field's business name and description, suggest 2-5 alternate " +
  "phrases a business user might type when asking about this field in natural language. Base " +
  "them on the field's actual business MEANING and context - never just mechanical variations " +
  "of the field name itself (e.g. inserting/removing spaces, changing case, or pluralizing). " +
  "For example, for a field named 'Resolved AT' meaning the timestamp a case was closed out, " +
  "good synonyms are 'closed date', 'completion date', 'when it was fixed' - not 'resolved at', " +
  "'ResolvedAt', or 'resolved ats'.";

export const RelationshipSuggestionSchema = z.object({
  from_table: z.string(),
  from_column: z.string(),
  to_table: z.string(),
  to_column: z.string(),
  cardinality: z.string().default("many_to_one"),
  reason: z.string().default(""),
});
export type RelationshipSuggestion = z.infer<typeof RelationshipSuggestionSchema>;

const RelationshipSuggestionsSchema = z.object({ relationships: z.array(RelationshipSuggestionSchema).default([]) });
const SynonymSuggestionsSchema = z.object({ synonyms: z.array(z.string()).default([]) });

/**
 * LLM-guessed relationships from column/table naming alone, for table pairs
 * a real foreign key wasn't already found for - a fallback for databases
 * that don't declare FKs, never a replacement for them. Every suggestion is
 * surfaced to the user for accept/reject in the Relationships step, never
 * applied automatically.
 */
export async function suggestRelationships(chatModel: ChatModel, tables: Record<string, string[]>): Promise<RelationshipSuggestion[]> {
  if (Object.keys(tables).length < 2) return [];
  const userPrompt =
    "Tables and their columns:\n" +
    Object.entries(tables)
      .map(([table, columns]) => `- ${table}: ${columns.join(", ")}`)
      .join("\n");
  const result = await generateStructured(chatModel, {
    systemPrompt: RELATIONSHIP_SYSTEM_PROMPT,
    userPrompt,
    schema: RelationshipSuggestionsSchema,
  });
  const knownTables = new Set(Object.keys(tables).map((t) => t.toLowerCase()));
  return result.relationships.filter((r) => knownTables.has(r.from_table.toLowerCase()) && knownTables.has(r.to_table.toLowerCase()));
}

/**
 * Business-meaning synonyms for one dimension or measure - used by the
 * Synonyms editor's per-field "Generate synonyms" action. Deliberately a
 * small, targeted call (one field at a time) rather than bulk-generating for
 * a whole entity, so the result is easy to review/merge without silently
 * overwriting synonyms the user already wrote.
 */
export async function generateSynonymsForField(
  chatModel: ChatModel,
  entityName: string,
  fieldName: string,
  description: string
): Promise<string[]> {
  const userPrompt = `Entity: ${entityName}\nField: ${fieldName}\nDescription: ${description || "(none given)"}`;
  const result = await generateStructured(chatModel, {
    systemPrompt: SYNONYM_SYSTEM_PROMPT,
    userPrompt,
    schema: SynonymSuggestionsSchema,
  });
  return result.synonyms;
}

export const SYSTEM_PROMPT =
  "You are a data modeling assistant building a semantic layer for analytics. " +
  "Given a database table name and its FULL column list, propose a business-friendly Entity. " +
  "You MUST classify every single column from the input list into either `dimensions` " +
  "(categorical/date/text/boolean/identifier attributes) or `measures` (numeric and " +
  "aggregatable values such as amounts, counts, quantities) - the only columns you may " +
  "leave out are pure technical surrogate keys with no business meaning (and even those " +
  "should still be listed in `primary_keys` if they are the table's key). Do not stop " +
  "after just one or two columns - keep going until every column has been placed. " +
  "Never invent a column that is not present in the input column list, and never merge " +
  "two input columns into one dimension or measure. " +
  "Pick a readable entity name, write a short business description for the entity and " +
  "each column, and suggest 2-4 plausible business synonyms for each dimension name.";

const GeneratedEntityDraftSchema = z.object({
  name: z.string(),
  table_name: z.string(),
  description: z.string().default(""),
  primary_keys: z.array(z.string()).default([]),
  dimensions: z.array(DimensionSchema).default([]),
  measures: z.array(MeasureSchema).default([]),
});
export type GeneratedEntityDraft = z.infer<typeof GeneratedEntityDraftSchema>;

const ColumnBatchDraftSchema = z.object({
  dimensions: z.array(DimensionSchema).default([]),
  measures: z.array(MeasureSchema).default([]),
});

export interface ColumnInput {
  name: string;
  datatype?: string;
}

/** Bare, lower-cased column name - strips a table qualifier and SQL quoting
 * ("`orders`.`order_total`" -> "order_total"). */
function columnKey(name: string): string {
  const last = name.split(".").pop() ?? name;
  return last.replace(/[`"[\]]/g, "").trim().toLowerCase();
}

/** Lower-cased identifiers an expression mentions - "SUM(orders.order_total)"
 * -> ["sum", "orders", "order_total"]. Function names come along too, which
 * is harmless: they're only ever compared against real column names. */
function expressionIdentifiers(expression: string): string[] {
  return expression.toLowerCase().match(/[a-z_][a-z0-9_$]*/g) ?? [];
}

/** Columns the draft already classifies: a dimension's column, or any column
 * a measure's expression uses (models usually write "SUM(order_total)", not
 * the bare column name). */
function coveredColumnNames(draft: GeneratedEntityDraft): Set<string> {
  const covered = new Set(draft.dimensions.map((d) => columnKey(d.column_name)));
  for (const m of draft.measures) {
    for (const id of expressionIdentifiers(m.expression)) covered.add(id);
  }
  return covered;
}

function normalizeExpression(expression: string): string {
  return expression.toLowerCase().replace(/[`"\s]/g, "");
}

/** Appends `batch`'s dimensions/measures to `draft`, skipping duplicates - a
 * dimension for a column that already has one, or a measure whose name or
 * expression is already present. */
function mergeDraft(
  draft: GeneratedEntityDraft,
  batch: Pick<GeneratedEntityDraft, "dimensions" | "measures">
): GeneratedEntityDraft {
  const dimensions = [...draft.dimensions];
  const dimColumns = new Set(dimensions.map((d) => columnKey(d.column_name)));
  const dimNames = new Set(dimensions.map((d) => d.name.toLowerCase()));
  for (const d of batch.dimensions) {
    const col = columnKey(d.column_name);
    if (dimColumns.has(col) || dimNames.has(d.name.toLowerCase())) continue;
    dimensions.push(d);
    dimColumns.add(col);
    dimNames.add(d.name.toLowerCase());
  }

  const measures = [...draft.measures];
  const measureNames = new Set(measures.map((m) => m.name.toLowerCase()));
  const measureExprs = new Set(measures.map((m) => normalizeExpression(m.expression)));
  for (const m of batch.measures) {
    const expr = normalizeExpression(m.expression);
    if (measureNames.has(m.name.toLowerCase()) || measureExprs.has(expr)) continue;
    measures.push(m);
    measureNames.add(m.name.toLowerCase());
    measureExprs.add(expr);
  }
  return { ...draft, dimensions, measures };
}

function uncoveredColumns(columnNames: string[], draft: GeneratedEntityDraft): string[] {
  const covered = coveredColumnNames(draft);
  const primaryKeys = new Set(draft.primary_keys.map(columnKey));
  return columnNames.filter((name) => !covered.has(name.toLowerCase()) && !primaryKeys.has(name.toLowerCase()));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Classifies just `batch` (with the full column list as context) into new
 * dimensions/measures. */
async function draftColumnBatch(
  chatModel: ChatModel,
  tableName: string,
  allColumnNames: string[],
  batch: ColumnInput[]
): Promise<Pick<GeneratedEntityDraft, "dimensions" | "measures">> {
  const prompt =
    `Table: ${tableName}\n` +
    `All columns of this table, for context only: ${JSON.stringify(allColumnNames)}\n` +
    `Classify ONLY these ${batch.length} columns (name, datatype) into dimensions or measures: ${JSON.stringify(batch)}\n` +
    "Return just the new dimensions/measures as JSON.";
  return generateStructured(chatModel, {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: prompt,
    schema: ColumnBatchDraftSchema,
    maxRetries: 0,
  });
}

/**
 * Drafts one Entity in column batches of `batchSize`, then repairs the draft
 * (re-prompting, again in batches, with the specific columns it skipped)
 * until every input column is covered by a dimension or a measure.
 *
 * Batching keeps every LLM answer short: the time a call takes grows with the
 * number of columns it has to write out, so a wide table drafted in a single
 * call outlasts the client timeout on slower local hardware, and small models
 * tend to stop after classifying just a handful of columns anyway. The first
 * batch also produces the entity's name, description and primary keys; each
 * call sees the full column list for context.
 */
export async function generateEntityDraft(
  chatModel: ChatModel,
  tableName: string,
  columns: ColumnInput[],
  options: { batchSize?: number; maxCoverageRetries?: number } = {}
): Promise<GeneratedEntityDraft> {
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_COLUMN_BATCH_SIZE);
  const maxCoverageRetries = options.maxCoverageRetries ?? 2;
  const columnNames = columns.map((c) => c.name);
  const [firstBatch = [], ...restBatches] = chunk(columns, batchSize);

  const userPrompt =
    `Table: ${tableName}\n` +
    (restBatches.length
      ? `All ${columnNames.length} columns of this table, for context: ${JSON.stringify(columnNames)}\n` +
        `Classify ONLY these ${firstBatch.length} columns (name, datatype) into dimensions or measures - ` +
        `the rest are handled separately: ${JSON.stringify(firstBatch)}\n`
      : `Columns (name, datatype) - exactly ${columnNames.length} columns, all must be classified: ${JSON.stringify(columns)}\n`) +
    "Return the Entity draft as JSON.";
  const initial = await generateStructured(chatModel, {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    schema: GeneratedEntityDraftSchema,
    maxRetries: 0,
  });
  // Merging into an empty draft also drops duplicates within the first answer.
  let draft = mergeDraft({ ...initial, dimensions: [], measures: [] }, initial);

  for (const [i, batch] of restBatches.entries()) {
    logger.debug("semantic_entity_draft_batch", { table: tableName, batch: `${i + 2}/${restBatches.length + 1}` });
    draft = mergeDraft(draft, await draftColumnBatch(chatModel, tableName, columnNames, batch));
  }

  for (let attempt = 1; attempt <= maxCoverageRetries; attempt++) {
    const missing = uncoveredColumns(columnNames, draft);
    if (!missing.length) break;
    const missingSet = new Set(missing);
    const missingColumns = columns.filter((c) => missingSet.has(c.name));
    logger.debug("semantic_entity_draft_incomplete", { table: tableName, attempt, missing_columns: missing });
    for (const batch of chunk(missingColumns, batchSize)) {
      draft = mergeDraft(draft, await draftColumnBatch(chatModel, tableName, columnNames, batch));
    }
  }

  const stillMissing = uncoveredColumns(columnNames, draft);
  if (stillMissing.length) {
    logger.warning("semantic_entity_draft_columns_uncovered", { table: tableName, missing_columns: stillMissing });
  }
  return draft;
}

/**
 * Each table is drafted on its own, so the LLM sometimes adds a dimension
 * `reference` pointing at a *table* name (e.g. "customers") rather than that
 * table's generated entity name (e.g. "Customer"), or at a table the user
 * didn't select. `SemanticModel` rejects unknown targets outright, failing
 * the whole draft - so map table names to entity names, and drop references
 * that still don't resolve (relationships are reviewed in their own step).
 */
function resolveDraftReferences(entities: Entity[]): Entity[] {
  const byName = new Map<string, string>();
  for (const e of entities) {
    byName.set(e.name.toLowerCase(), e.name);
    byName.set(e.table_name.toLowerCase(), e.name);
  }
  return entities.map((entity) => ({
    ...entity,
    dimensions: entity.dimensions.map((dim) => {
      if (!dim.reference) return dim;
      const target = byName.get(dim.reference.target_entity.toLowerCase());
      if (!target) {
        logger.debug("semantic_draft_reference_dropped", {
          entity: entity.name,
          dimension: dim.name,
          target_entity: dim.reference.target_entity,
        });
        return { ...dim, reference: null };
      }
      return { ...dim, reference: { ...dim.reference, target_entity: target } };
    }),
  }));
}

/**
 * Schema Discovery -> LLM -> draft SemanticModel for the user-selected
 * tables.
 *
 * Each table is drafted by its own LLM call (small, reliable prompts, with
 * per-table coverage repair), and up to `concurrency` tables are drafted at
 * once. Entities keep the input table order regardless of which finishes
 * first. If any table fails, no new tables are started, the ones already in
 * flight are allowed to finish, and the error names every failed table.
 *
 * The result is intentionally NOT published automatically - callers must run
 * it through `validateSemanticModel` and a human review step before it
 * becomes the active model.
 */
export async function generateSemanticModelDraft(
  chatModel: ChatModel,
  tables: Record<string, ColumnInput[]>,
  options: { concurrency?: number; columnBatchSize?: number } = {}
): Promise<SemanticModel> {
  const entries = Object.entries(tables);
  const total = entries.length;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, total || 1));
  logger.debug("semantic_model_draft_started", { table_count: total, concurrency, tables: Object.keys(tables) });
  const started = Date.now();

  const entities: (Entity | undefined)[] = new Array(total);
  const failures: { table: string; error: unknown }[] = [];
  let next = 0;
  let completed = 0;

  const draftTable = async (index: number): Promise<void> => {
    const [tableName, columns] = entries[index];
    logger.debug("semantic_entity_draft_started", { table: tableName, column_count: columns.length });
    const start = Date.now();
    try {
      const draft = await generateEntityDraft(chatModel, tableName, columns, { batchSize: options.columnBatchSize });
      entities[index] = {
        name: draft.name,
        table_name: draft.table_name || tableName,
        description: draft.description,
        primary_keys: draft.primary_keys,
        dimensions: draft.dimensions,
        measures: draft.measures,
      };
      completed += 1;
      logger.debug("semantic_entity_draft_completed", {
        table: tableName,
        progress: `${completed}/${total}`,
        dimension_count: draft.dimensions.length,
        measure_count: draft.measures.length,
        elapsed_ms: Date.now() - start,
      });
    } catch (exc) {
      failures.push({ table: tableName, error: exc });
      logger.warning("semantic_entity_draft_failed", { table: tableName, error: String(exc) });
    }
  };

  // A fixed pool of workers, each pulling the next table until none are left
  // (or a failure means the whole draft will be rejected anyway).
  const worker = async (): Promise<void> => {
    while (next < total && failures.length === 0) {
      const index = next;
      next += 1;
      await draftTable(index);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  if (failures.length) {
    const first = failures[0].error;
    const prefix = `Semantic model generation failed for table(s): ${failures.map((f) => f.table).join(", ")}.`;
    // Rethrow the original error (keeping its type/status, e.g. LLMError,
    // for the API's error handler) with the failed tables named up front.
    if (first instanceof Error) {
      first.message = `${prefix} ${first.message}`;
      throw first;
    }
    throw new Error(`${prefix} ${String(first)}`);
  }

  logger.info("semantic_model_draft_completed", {
    table_count: total,
    concurrency,
    entity_count: total,
    elapsed_ms: Date.now() - started,
  });
  const data: SemanticModelData = {
    version: "1.0.0",
    data_source_id: null,
    entities: resolveDraftReferences(entities as Entity[]),
    metrics: [],
    kpis: [],
  };
  return new SemanticModel(data);
}
