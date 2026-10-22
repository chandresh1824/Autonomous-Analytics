import { randomUUID } from "node:crypto";
import { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ConversationRow, MessageRow } from "./models";

/** Thrown when a conversation id exists but belongs to another user (or to
 * no one - rows from before per-user history). */
export class ConversationNotFoundError extends Error {
  constructor() {
    super("Conversation not found");
    this.name = "ConversationNotFoundError";
  }
}

/** Every read and write is scoped to one user: a conversation is only ever
 * visible to, and changed by, the user who started it. */
export class ConversationRepository {
  constructor(private readonly db: Pool) {}

  async getOrCreate(userId: string, conversationId: string | null | undefined, title: string): Promise<ConversationRow> {
    if (conversationId) {
      const [rows] = await this.db.execute<RowDataPacket[]>("SELECT * FROM conversations WHERE id = ?", [
        conversationId,
      ]);
      const existing = rows[0] as ConversationRow | undefined;
      if (existing) {
        if (existing.user_id !== userId) throw new ConversationNotFoundError();
        return existing;
      }
    }
    const id = conversationId || randomUUID();
    const now = new Date().toISOString();
    const finalTitle = title ? title.slice(0, 300) : "New conversation";
    await this.db.execute(
      "INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [id, userId, finalTitle, now, now]
    );
    return { id, user_id: userId, title: finalTitle, created_at: now, updated_at: now };
  }

  async addMessage(conversationId: string, role: string, content: unknown): Promise<MessageRow> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const contentJson = JSON.stringify(content);
    await this.db.execute(
      "INSERT INTO messages (id, conversation_id, role, content_json, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, conversationId, role, contentJson, now]
    );
    await this.db.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", [now, conversationId]);
    return { id, conversation_id: conversationId, role, content_json: contentJson, created_at: now };
  }

  async listConversations(userId: string): Promise<ConversationRow[]> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      "SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC",
      [userId]
    );
    return rows as ConversationRow[];
  }

  /** The conversation's messages, or null when it isn't this user's. */
  async getMessages(userId: string, conversationId: string): Promise<MessageRow[] | null> {
    const [owned] = await this.db.execute<RowDataPacket[]>(
      "SELECT id FROM conversations WHERE id = ? AND user_id = ?",
      [conversationId, userId]
    );
    if (owned.length === 0) return null;
    const [rows] = await this.db.execute<RowDataPacket[]>(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at",
      [conversationId]
    );
    return rows as MessageRow[];
  }

  /** Deletes the user's conversation, its messages, and the dashboard
   * widgets pinned from it, together. */
  async delete(userId: string, conversationId: string): Promise<boolean> {
    const connection = await this.db.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        "DELETE FROM conversations WHERE id = ? AND user_id = ?",
        [conversationId, userId]
      );
      if (result.affectedRows === 0) {
        await connection.rollback();
        return false;
      }
      await connection.execute("DELETE FROM messages WHERE conversation_id = ?", [conversationId]);
      await connection.execute("DELETE FROM pinned_widgets WHERE conversation_id = ? AND user_id = ?", [
        conversationId,
        userId,
      ]);
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
