import { randomUUID } from "node:crypto";
import { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { PinnedWidgetCreate, PinnedWidgetOut, PinnedWidgetSnapshot } from "../schemas/pinnedWidget";
import { PinnedWidgetRow } from "./models";

function toOut(row: PinnedWidgetRow): PinnedWidgetOut {
  const snapshot = JSON.parse(row.snapshot_json) as PinnedWidgetSnapshot;
  return {
    id: row.id,
    title: row.title,
    question: row.question,
    conversation_id: row.conversation_id,
    message_id: row.message_id,
    created_at: row.created_at,
    ...snapshot,
  };
}

/**
 * Widgets pinned from the chat UI onto the Dashboard - each row is a
 * standalone snapshot (see `PinnedWidgetCreateSchema`'s docstring), not a
 * live query, so listing/rendering them never touches a `DataSource` or the
 * LLM at all. Each user has their own widgets and their own order.
 */
export class PinnedWidgetRepository {
  constructor(private readonly db: Pool) {}

  /** The user's widgets in their saved order. Widgets pinned since the order
   * was last saved (no sort_order yet) come first, newest first. */
  async list(userId: string): Promise<PinnedWidgetOut[]> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      "SELECT * FROM pinned_widgets WHERE user_id = ? ORDER BY (sort_order IS NULL) DESC, sort_order ASC, created_at DESC",
      [userId]
    );
    return (rows as PinnedWidgetRow[]).map(toOut);
  }

  async create(userId: string, payload: PinnedWidgetCreate): Promise<PinnedWidgetOut> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const title = payload.title || payload.question;
    const snapshot: PinnedWidgetSnapshot = {
      summary: payload.summary,
      insights: payload.insights,
      visualization: payload.visualization,
      table: payload.table,
      metadata: payload.metadata,
      sql: payload.sql,
    };
    const row: PinnedWidgetRow = {
      id,
      user_id: userId,
      sort_order: null,
      title,
      question: payload.question,
      conversation_id: payload.conversation_id,
      message_id: payload.message_id,
      snapshot_json: JSON.stringify(snapshot),
      created_at: now,
    };
    await this.db.execute(
      `INSERT INTO pinned_widgets (id, user_id, sort_order, title, question, conversation_id, message_id, snapshot_json, created_at)
       VALUES (:id, :user_id, :sort_order, :title, :question, :conversation_id, :message_id, :snapshot_json, :created_at)`,
      { ...row }
    );
    return toOut(row);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const [result] = await this.db.execute<ResultSetHeader>("DELETE FROM pinned_widgets WHERE id = ? AND user_id = ?", [
      id,
      userId,
    ]);
    return result.affectedRows > 0;
  }

  /** Saves the user's dashboard order: `ids[0]` first. Ids that aren't the
   * user's are ignored. */
  async saveOrder(userId: string, ids: string[]): Promise<void> {
    const connection = await this.db.getConnection();
    try {
      await connection.beginTransaction();
      for (const [index, id] of ids.entries()) {
        await connection.execute("UPDATE pinned_widgets SET sort_order = ? WHERE id = ? AND user_id = ?", [
          index,
          id,
          userId,
        ]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
