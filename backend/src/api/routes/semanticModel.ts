import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { getSettings } from "../../core/config";
import { getLogger } from "../../core/logging";
import { getSemanticPlannerChatModel } from "../../services/llm/client";
import {
  generateSemanticModelDraft,
  generateSynonymsForField,
  RelationshipSuggestion,
  suggestRelationships,
} from "../../services/semantic/generator";
import { parseSemanticModelDict } from "../../services/semantic/parser";
import { getPublishBlockers, validateSemanticModel } from "../../services/semantic/validator";
import { SemanticModelVersionRow } from "../../repositories/models";
import { asyncHandler } from "../asyncHandler";
import { getDatasourceRegistry, getRagAgentDep, getSemanticRepository, resolveConnection } from "../dependencies";
import { HttpError } from "../errorHandler";

const logger = getLogger("api.routes.semanticModel");
const upload = multer();

export const semanticModelRouter = Router();

semanticModelRouter.get(
  "/api/semantic-model",
  asyncHandler(async (req, res) => {
    const publishedOnly = req.query.published_only === "true";
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getSemanticRepository();
    const model = await (publishedOnly ? repo.getActive(connection.id) : repo.getWorking(connection.id));
    if (!model) {
      const detail = publishedOnly
        ? `No semantic model has been published yet for '${connection.name}'`
        : `No semantic model has been loaded yet for '${connection.name}'`;
      throw new HttpError(404, detail);
    }
    res.json(model.toJSON());
  })
);

semanticModelRouter.get(
  "/api/semantic-model/versions",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getSemanticRepository();
    const versions = await repo.listVersions(connection.id);
    res.json(versions.map((v) => ({ id: v.id, version_number: v.version_number, status: v.status, created_at: v.created_at })));
  })
);

/**
 * Publishes this connection's draft, replacing its previously published
 * model - the one shared "make my changes live" action for everything that
 * lives in the semantic model (entities, dimensions, measures,
 * relationships, synonyms, metrics, and KPIs all version together as a
 * single model), used by both the Semantic Model and KPI settings panels
 * rather than each having its own separate publish button. A no-op when
 * there is no pending draft. See `SemanticModelRepository.publish`.
 */
semanticModelRouter.post(
  "/api/semantic-model/publish",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getSemanticRepository();
    const ragAgent = getRagAgentDep();
    const versions = await repo.listVersions(connection.id);
    if (!versions.length) throw new HttpError(404, "No semantic model version to publish");
    const latest = versions[0];
    assertPublishable(latest);
    const published = await repo.publish(latest.id);
    if (!published) throw new HttpError(404, "Version not found");
    try {
      await ragAgent.index(parseSemanticModelDict(JSON.parse(published.content_json)));
    } catch (exc) {
      logger.exception("rag_reindex_after_publish_failed", { version_id: published.id, error: String(exc) });
    }
    res.json({ id: published.id, status: published.status });
  })
);

semanticModelRouter.post(
  "/api/semantic-model/validate",
  asyncHandler(async (req, res) => {
    const payload = parseSemanticModelDict(req.body);
    res.json(validateSemanticModel(payload));
  })
);

/**
 * Saves the model as `connection`'s draft (overwriting any existing draft
 * for that connection only). It is NOT published/active until a subsequent
 * call to /{versionId}/publish or /publish.
 */
semanticModelRouter.post(
  "/api/semantic-model/import",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getSemanticRepository();
    const payload = parseSemanticModelDict(req.body);
    const validation = validateSemanticModel(payload);
    const version = await repo.saveDraft(payload, connection.id);
    res.json({ ...validation, version_id: version.id });
  })
);

semanticModelRouter.post(
  "/api/semantic-model/upload",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getSemanticRepository();
    if (!req.file) throw new HttpError(422, "A file upload is required");
    const raw = JSON.parse(req.file.buffer.toString("utf-8"));
    const model = parseSemanticModelDict(raw);
    const validation = validateSemanticModel(model);
    await repo.saveDraft(model, connection.id);
    res.json(validation);
  })
);

/** Loads a version by id, 404ing when it doesn't exist or (when the caller
 * names a `connection_id`) belongs to a different connection - so an action
 * aimed at one connection's model can never land on another's. */
async function getScopedVersion(versionId: string, connectionId: unknown) {
  const repo = getSemanticRepository();
  const version = await repo.getVersion(versionId);
  if (!version) throw new HttpError(404, "Version not found");
  if (typeof connectionId === "string" && connectionId && version.data_source_id !== connectionId) {
    throw new HttpError(404, "Version not found for this connection");
  }
  return version;
}

/** Refuses to publish a model with no dimensions or no measures (422). */
function assertPublishable(version: SemanticModelVersionRow): void {
  const blockers = getPublishBlockers(parseSemanticModelDict(JSON.parse(version.content_json)));
  if (blockers.length) throw new HttpError(422, blockers.join(" "));
}

semanticModelRouter.delete(
  "/api/semantic-model/:versionId",
  asyncHandler(async (req, res) => {
    await getScopedVersion(req.params.versionId, req.query.connection_id);
    const repo = getSemanticRepository();
    const deleted = await repo.delete(req.params.versionId);
    if (!deleted) throw new HttpError(404, "Version not found");
    res.status(204).end();
  })
);

semanticModelRouter.post(
  "/api/semantic-model/:versionId/publish",
  asyncHandler(async (req, res) => {
    const source = await getScopedVersion(req.params.versionId, req.query.connection_id);
    assertPublishable(source);
    const repo = getSemanticRepository();
    const ragAgent = getRagAgentDep();
    const version = await repo.publish(req.params.versionId);
    if (!version) throw new HttpError(404, "Version not found");
    // Keep the RAG index in lockstep with what's active - indexing failure
    // shouldn't block the publish itself (the version is already committed).
    try {
      await ragAgent.index(parseSemanticModelDict(JSON.parse(version.content_json)));
    } catch (exc) {
      logger.exception("rag_reindex_after_publish_failed", { version_id: req.params.versionId, error: String(exc) });
    }
    res.json({ id: version.id, status: version.status });
  })
);

semanticModelRouter.post(
  "/api/semantic-model/index",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const repo = getSemanticRepository();
    const ragAgent = getRagAgentDep();
    const model = await repo.getActive(connection.id);
    if (!model) throw new HttpError(404, `No published semantic model to index for '${connection.name}'`);
    const count = await ragAgent.index(model);
    res.json({ indexed_documents: count });
  })
);

/** Lists the datasource's tables (with their full column list, not just a
 * count) so the UI can offer table selection before generating a semantic
 * model. */
semanticModelRouter.get(
  "/api/semantic-model/tables",
  asyncHandler(async (req, res) => {
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const registry = getDatasourceRegistry();
    const datasource = await registry.resolve(connection.id);
    const schema = await datasource.getSchema();
    res.json(Object.entries(schema).map(([name, columns]) => ({ table_name: name, column_count: columns.length, columns })));
  })
);

/**
 * Relationship suggestions for the Relationships step: real, DB-declared
 * foreign keys first (high confidence), then an LLM guess pass from column
 * naming for any table pair a foreign key wasn't already found for. Every
 * suggestion is for review/accept-or-reject in the UI - never applied
 * automatically.
 */
semanticModelRouter.get(
  "/api/semantic-model/relationships/suggest",
  asyncHandler(async (req, res) => {
    const rawTables = req.query.tables;
    const tables = Array.isArray(rawTables) ? (rawTables as string[]) : rawTables ? [rawTables as string] : [];
    const selected = new Set(tables);
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const registry = getDatasourceRegistry();
    const datasource = await registry.resolve(connection.id);
    let schema = await datasource.getSchema();
    const missing = [...selected].filter((t) => !(t in schema));
    if (missing.length) {
      throw new HttpError(400, `Unknown table(s) for this connection: ${missing.sort().join(", ")}`);
    }
    schema = Object.fromEntries(Object.entries(schema).filter(([name]) => selected.has(name)));

    const foreignKeys = await datasource.getForeignKeys();
    const suggestions: Record<string, unknown>[] = [];
    const coveredPairs = new Set<string>();
    for (const fk of foreignKeys) {
      if (!selected.has(fk.from_table) || !selected.has(fk.to_table)) continue;
      suggestions.push({
        from_table: fk.from_table,
        from_column: fk.from_column,
        to_table: fk.to_table,
        to_column: fk.to_column,
        cardinality: "many_to_one",
        reason: "Declared foreign key in the database schema.",
        source: "database",
      });
      coveredPairs.add(`${fk.from_table} ${fk.to_table}`);
      coveredPairs.add(`${fk.to_table} ${fk.from_table}`);
    }

    if (Object.keys(schema).length >= 2) {
      const tablesForLlm = Object.fromEntries(Object.entries(schema).map(([name, columns]) => [name, columns.map((c) => c.name)]));
      let llmGuesses: RelationshipSuggestion[];
      try {
        llmGuesses = await suggestRelationships(getSemanticPlannerChatModel(), tablesForLlm);
      } catch (exc) {
        logger.exception("relationship_suggestion_llm_failed", { tables: [...selected], error: String(exc) });
        llmGuesses = [];
      }
      for (const guess of llmGuesses) {
        if (coveredPairs.has(`${guess.from_table} ${guess.to_table}`)) continue;
        suggestions.push({
          from_table: guess.from_table,
          from_column: guess.from_column,
          to_table: guess.to_table,
          to_column: guess.to_column,
          cardinality: guess.cardinality,
          reason: guess.reason,
          source: "llm",
        });
      }
    }
    res.json(suggestions);
  })
);

const SynonymSuggestRequestSchema = z.object({
  entity_name: z.string(),
  field_name: z.string(),
  description: z.string().default(""),
});

/** Business-meaning synonyms for one dimension or measure - the result is
 * merged into the field's editable synonym list client-side, never saved
 * directly. */
semanticModelRouter.post(
  "/api/semantic-model/synonyms/suggest",
  asyncHandler(async (req, res) => {
    const payload = SynonymSuggestRequestSchema.parse(req.body);
    const synonyms = await generateSynonymsForField(getSemanticPlannerChatModel(), payload.entity_name, payload.field_name, payload.description);
    res.json({ synonyms });
  })
);

const GenerateRequestSchema = z.object({
  columns: z.record(z.array(z.string())).optional(),
});

/**
 * Schema Discovery -> LLM draft. The draft is returned for human review and
 * is NOT saved or published automatically - call /import (then
 * /{versionId}/publish) once reviewed.
 */
semanticModelRouter.post(
  "/api/semantic-model/generate",
  asyncHandler(async (req, res) => {
    const rawTables = req.query.tables;
    const requestedTables = Array.isArray(rawTables) ? (rawTables as string[]) : rawTables ? [rawTables as string] : null;
    const connection = await resolveConnection(req.query.connection_id as string | undefined);
    const registry = getDatasourceRegistry();
    logger.debug("semantic_model_generate_requested", { connection_id: connection.id, requested_tables: requestedTables });
    const datasource = await registry.resolve(connection.id);
    let schema = await datasource.getSchema();
    if (requestedTables) {
      const selected = new Set(requestedTables);
      const missing = [...selected].filter((t) => !(t in schema));
      if (missing.length) throw new HttpError(400, `Unknown table(s) for this connection: ${missing.sort().join(", ")}`);
      schema = Object.fromEntries(Object.entries(schema).filter(([name]) => selected.has(name)));
    }
    // Optional per-table column selection - only these columns are sent to
    // the LLM (fewer columns = fewer, shorter calls). Tables not listed keep
    // all their columns.
    const { columns: requestedColumns } = GenerateRequestSchema.parse(req.body ?? {});
    if (requestedColumns) {
      for (const [table, wanted] of Object.entries(requestedColumns)) {
        if (!(table in schema)) throw new HttpError(400, `Column selection given for an unselected/unknown table: ${table}`);
        if (!wanted.length) throw new HttpError(400, `Select at least one column for table '${table}'`);
        const wantedSet = new Set(wanted);
        const unknown = wanted.filter((c) => !schema[table].some((col) => col.name === c));
        if (unknown.length) throw new HttpError(400, `Unknown column(s) on '${table}': ${unknown.sort().join(", ")}`);
        schema[table] = schema[table].filter((col) => wantedSet.has(col.name));
      }
    }
    const draft = await generateSemanticModelDraft(getSemanticPlannerChatModel(), schema, {
      concurrency: getSettings().semanticGenerationConcurrency,
      columnBatchSize: getSettings().semanticGenerationBatchSize,
    });
    logger.info("semantic_model_generate_completed", { connection_id: connection.id, entity_count: draft.entities.length });
    res.json(draft.copyWith({ data_source_id: connection.id }).toJSON());
  })
);
