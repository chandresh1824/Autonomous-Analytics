import { randomUUID } from "node:crypto";
import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { SemanticModel } from "../schemas/semantic";
import { parseSemanticModelDict } from "../services/semantic/parser";
import { SemanticModelVersionRow } from "./models";

type Queryable = Pick<Pool | PoolConnection, "execute">;

/**
 * The application database is the sole source of truth for every semantic
 * model - nothing is ever auto-seeded from a JSON file on disk; a data
 * source starts with no model until one is explicitly created (generated,
 * uploaded, or imported) and saved here.
 *
 * Every semantic model version belongs to exactly one data source
 * (`data_source_id`, the owning connection's id) - all lookups and writes are
 * scoped to it so each database gets its own catalog, and editing one
 * connection's model never touches another's rows.
 *
 * Per data source there is at most one draft (unpublished edits) and one
 * published model. Saving edits overwrites the existing draft in place, and
 * publishing replaces the previous published model - rather than piling up
 * a new row on every save.
 */
export class SemanticModelRepository {
  constructor(private readonly db: Pool) {}

  private async latestVersionNumber(dataSourceId: string, conn: Queryable = this.db, lock = false): Promise<number> {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT version_number FROM semantic_model_versions WHERE data_source_id = ? ORDER BY version_number DESC LIMIT 1${
        lock ? " FOR UPDATE" : ""
      }`,
      [dataSourceId]
    );
    const row = rows[0] as { version_number: number } | undefined;
    return row ? row.version_number : 0;
  }

  /** The latest *published* version for this data source - what the chat
   * pipeline and RAG index are grounded in. */
  async getActive(dataSourceId: string): Promise<SemanticModel | null> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      "SELECT * FROM semantic_model_versions WHERE data_source_id = ? AND status = 'published' ORDER BY version_number DESC LIMIT 1",
      [dataSourceId]
    );
    const row = rows[0] as SemanticModelVersionRow | undefined;
    return row ? parseSemanticModelDict(JSON.parse(row.content_json)) : null;
  }

  /** Every data source's published model, keyed by data source id - one
   * query, for routing a question across all databases. */
  async getAllActive(): Promise<Map<string, SemanticModel>> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      "SELECT * FROM semantic_model_versions WHERE status = 'published' AND data_source_id IS NOT NULL ORDER BY version_number DESC"
    );
    const models = new Map<string, SemanticModel>();
    for (const row of rows as SemanticModelVersionRow[]) {
      // Rows are newest-first, so the first one seen per source wins.
      if (row.data_source_id && !models.has(row.data_source_id)) {
        models.set(row.data_source_id, parseSemanticModelDict(JSON.parse(row.content_json)));
      }
    }
    return models;
  }

  /** The latest version for this data source regardless of status - used by
   * the Settings UI so in-progress edits are visible before publish. */
  async getWorking(dataSourceId: string): Promise<SemanticModel | null> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      "SELECT * FROM semantic_model_versions WHERE data_source_id = ? ORDER BY version_number DESC LIMIT 1",
      [dataSourceId]
    );
    const row = rows[0] as SemanticModelVersionRow | undefined;
    return row ? parseSemanticModelDict(JSON.parse(row.content_json)) : null;
  }

  /**
   * Saves `model` as this data source's draft, overwriting the existing
   * draft if there is one (only a first edit after a publish creates a new
   * draft row). The published model is left untouched until `publish`.
   */
  async saveDraft(model: SemanticModel, dataSourceId: string): Promise<SemanticModelVersionRow> {
    const scoped = model.copyWith({ data_source_id: dataSourceId });
    const contentJson = JSON.stringify(scoped.toJSON());
    const now = new Date().toISOString();

    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();
      const [drafts] = await conn.execute<RowDataPacket[]>(
        "SELECT * FROM semantic_model_versions WHERE data_source_id = ? AND status = 'draft' ORDER BY version_number DESC FOR UPDATE",
        [dataSourceId]
      );
      const existing = drafts[0] as SemanticModelVersionRow | undefined;
      let row: SemanticModelVersionRow;
      if (existing) {
        // A draft left over from older versioning can sit below the
        // published version; getWorking reads the highest version_number, so
        // renumber it to the top or the edit would be saved but never shown.
        const latest = await this.latestVersionNumber(dataSourceId, conn, true);
        const versionNumber = existing.version_number < latest ? latest + 1 : existing.version_number;
        row = { ...existing, version_number: versionNumber, content_json: contentJson, created_at: now };
        await conn.execute(
          "UPDATE semantic_model_versions SET version_number = :version_number, content_json = :content_json, created_at = :created_at WHERE id = :id",
          { id: row.id, version_number: row.version_number, content_json: row.content_json, created_at: row.created_at }
        );
        // Clears out any extra drafts left over from before drafts were
        // overwritten in place, so this one is the only draft.
        await conn.execute(
          "DELETE FROM semantic_model_versions WHERE data_source_id = ? AND status = 'draft' AND id <> ?",
          [dataSourceId, row.id]
        );
      } else {
        row = {
          id: randomUUID(),
          data_source_id: dataSourceId,
          version_number: (await this.latestVersionNumber(dataSourceId, conn, true)) + 1,
          content_json: contentJson,
          status: "draft",
          created_at: now,
        };
        await conn.execute(
          "INSERT INTO semantic_model_versions (id, data_source_id, version_number, content_json, status, created_at) VALUES (:id, :data_source_id, :version_number, :content_json, :status, :created_at)",
          { ...row }
        );
      }
      await conn.commit();
      return row;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async listVersions(dataSourceId: string): Promise<SemanticModelVersionRow[]> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      "SELECT * FROM semantic_model_versions WHERE data_source_id = ? ORDER BY version_number DESC",
      [dataSourceId]
    );
    return rows as SemanticModelVersionRow[];
  }

  async getVersion(versionId: string): Promise<SemanticModelVersionRow | null> {
    const [rows] = await this.db.execute<RowDataPacket[]>("SELECT * FROM semantic_model_versions WHERE id = ?", [
      versionId,
    ]);
    return (rows[0] as SemanticModelVersionRow | undefined) ?? null;
  }

  /**
   * Makes `versionId` this data source's published model, replacing the
   * previous one: the version is marked published and every other row for
   * the same data source (the old published model, and any archived rows
   * left from before publishing replaced in place) is removed in the same
   * transaction. Afterwards the data source has exactly one row, so
   * `getActive()` can never resolve to a stale model. Other data sources'
   * rows are never touched. Publishing an already-published version is a
   * no-op.
   */
  async publish(versionId: string): Promise<SemanticModelVersionRow | null> {
    const source = await this.getVersion(versionId);
    if (!source) return null;
    if (source.status === "published") return source;

    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();
      if (source.data_source_id) {
        await conn.execute(
          "DELETE FROM semantic_model_versions WHERE data_source_id = ? AND id <> ?",
          [source.data_source_id, source.id]
        );
      }
      const row: SemanticModelVersionRow = { ...source, status: "published", created_at: new Date().toISOString() };
      await conn.execute(
        "UPDATE semantic_model_versions SET status = :status, created_at = :created_at WHERE id = :id",
        { id: row.id, status: row.status, created_at: row.created_at }
      );
      await conn.commit();
      return row;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async delete(versionId: string): Promise<boolean> {
    const [result] = await this.db.execute<ResultSetHeader>("DELETE FROM semantic_model_versions WHERE id = ?", [
      versionId,
    ]);
    return result.affectedRows > 0;
  }

  /** Removes every version (draft or published) belonging to a data source -
   * used when the owning connection itself is deleted, so no orphaned
   * version rows are left referencing a connection id that no longer
   * exists. */
  async deleteAllForDataSource(dataSourceId: string): Promise<number> {
    const [result] = await this.db.execute<ResultSetHeader>(
      "DELETE FROM semantic_model_versions WHERE data_source_id = ?",
      [dataSourceId]
    );
    return result.affectedRows;
  }
}
