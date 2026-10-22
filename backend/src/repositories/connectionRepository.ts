import { randomUUID } from "node:crypto";
import { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { DataSourceError } from "../core/exceptions";
import { encryptSecret } from "../core/security";
import { ConnectionCreate, ConnectionOut, ConnectionUpdate } from "../schemas/connection";
import { ConnectionRow } from "./models";

function toOut(row: ConnectionRow): ConnectionOut {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    ssl: Boolean(row.ssl),
    enabled: Boolean(row.enabled),
    is_default: Boolean(row.is_default),
    // Lets the UI say "a password is saved" without ever receiving it.
    has_password: Boolean(row.password_encrypted),
  };
}

/**
 * Never returns raw password fields - callers get `ConnectionOut` (no
 * secret) for API responses, or the raw `ConnectionRow` (encrypted secret
 * only) when a `DataSource` actually needs to connect.
 */
export class ConnectionRepository {
  constructor(private readonly db: Pool) {}

  async list(): Promise<ConnectionOut[]> {
    const [rows] = await this.db.execute<RowDataPacket[]>("SELECT * FROM connections ORDER BY created_at");
    return (rows as ConnectionRow[]).map(toOut);
  }

  async getModel(connectionId: string): Promise<ConnectionRow | null> {
    const [rows] = await this.db.execute<RowDataPacket[]>("SELECT * FROM connections WHERE id = ?", [connectionId]);
    return (rows[0] as ConnectionRow | undefined) ?? null;
  }

  async get(connectionId: string): Promise<ConnectionRow | null> {
    return this.getModel(connectionId);
  }

  async getOut(connectionId: string): Promise<ConnectionOut | null> {
    const model = await this.getModel(connectionId);
    return model ? toOut(model) : null;
  }

  /**
   * Resolves an explicit connection id, or the default enabled connection
   * when none is given. This is the single definition of "which data
   * source" for a request - both query execution and semantic-model/RAG
   * lookups key off the same connection id so a chat request always reasons
   * about one consistent database.
   */
  async resolve(connectionId?: string | null): Promise<ConnectionRow> {
    const connection = connectionId ? await this.get(connectionId) : await this.getDefault();
    if (!connection) {
      throw new DataSourceError("No datasource connection is configured or enabled. Add one in Settings.");
    }
    if (!connection.enabled) {
      throw new DataSourceError(`Connection '${connection.name}' is disabled`);
    }
    return connection;
  }

  async getDefault(): Promise<ConnectionRow | null> {
    const [rows] = await this.db.execute<RowDataPacket[]>(
      "SELECT * FROM connections WHERE enabled = 1 ORDER BY is_default DESC, created_at ASC LIMIT 1"
    );
    return (rows[0] as ConnectionRow | undefined) ?? null;
  }

  async create(payload: ConnectionCreate): Promise<ConnectionOut> {
    const existing = await this.list();
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO connections
         (id, name, type, host, port, \`database\`, username, password_encrypted, \`ssl\`, enabled, is_default, created_at, updated_at)
       VALUES (:id, :name, :type, :host, :port, :database, :username, :password_encrypted, :ssl, :enabled, :is_default, :created_at, :updated_at)`,
      {
        id,
        name: payload.name,
        type: payload.type,
        host: payload.host ?? null,
        port: payload.port ?? null,
        database: payload.database ?? null,
        username: payload.username ?? null,
        password_encrypted: payload.password ? encryptSecret(payload.password) : null,
        ssl: payload.ssl ? 1 : 0,
        enabled: payload.enabled ? 1 : 0,
        is_default: existing.length === 0 ? 1 : 0,
        created_at: now,
        updated_at: now,
      }
    );
    const created = await this.getModel(id);
    return toOut(created!);
  }

  async update(connectionId: string, payload: ConnectionUpdate): Promise<ConnectionOut | null> {
    const model = await this.getModel(connectionId);
    if (!model) return null;

    const next: ConnectionRow = { ...model };
    if (payload.name != null) next.name = payload.name;
    if (payload.host !== undefined) next.host = payload.host;
    if (payload.port !== undefined) next.port = payload.port;
    if (payload.database !== undefined) next.database = payload.database;
    if (payload.username !== undefined) next.username = payload.username;
    // A missing, null or blank password means "keep the saved one" - the
    // stored secret is only replaced by a new non-empty value, and only
    // removed when the connection itself is deleted.
    if (payload.password) next.password_encrypted = encryptSecret(payload.password);
    if (payload.ssl != null) next.ssl = payload.ssl ? 1 : 0;
    if (payload.enabled != null) next.enabled = payload.enabled ? 1 : 0;
    next.updated_at = new Date().toISOString();

    await this.db.execute(
      `UPDATE connections SET name=:name, host=:host, port=:port, \`database\`=:database, username=:username,
         password_encrypted=:password_encrypted, \`ssl\`=:ssl, enabled=:enabled, updated_at=:updated_at WHERE id=:id`,
      { ...next }
    );
    const updated = await this.getModel(connectionId);
    return updated ? toOut(updated) : null;
  }

  async delete(connectionId: string): Promise<boolean> {
    const [result] = await this.db.execute<ResultSetHeader>("DELETE FROM connections WHERE id = ?", [connectionId]);
    return result.affectedRows > 0;
  }

  async setDefault(connectionId: string): Promise<ConnectionOut | null> {
    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>("SELECT * FROM connections WHERE id = ? FOR UPDATE", [
        connectionId,
      ]);
      const model = rows[0] as ConnectionRow | undefined;
      if (!model) {
        await conn.rollback();
        return null;
      }
      await conn.execute("UPDATE connections SET is_default = 0", []);
      await conn.execute("UPDATE connections SET is_default = 1 WHERE id = ?", [connectionId]);
      await conn.commit();
      return toOut({ ...model, is_default: 1 });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}
