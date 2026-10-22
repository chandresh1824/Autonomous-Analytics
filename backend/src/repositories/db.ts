import mysql, { Pool, RowDataPacket } from "mysql2/promise";
import { getSettings } from "../core/config";

const CONNECTION_LIMIT = 10;

let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    const settings = getSettings();

    const required: [string, string][] = [
      ["DB_HOST", settings.dbHost],
      ["DB_NAME", settings.dbName],
      ["DB_USER", settings.dbUser],
    ];
    const missing = required.filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) {
      throw new Error(
        `Application database is not configured - missing ${missing.join(", ")} in the environment.`
      );
    }

    pool = mysql.createPool({
      host: settings.dbHost,
      port: settings.dbPort,
      database: settings.dbName,
      user: settings.dbUser,
      password: settings.dbPassword,
      waitForConnections: true,
      connectionLimit: CONNECTION_LIMIT,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
      namedPlaceholders: true,
      timezone: "Z",
      dateStrings: true,
    });
  }
  return pool;
}

export async function initDb(): Promise<void> {
  const db = getDb();

  await db.query(`
    CREATE TABLE IF NOT EXISTS connections (
      id                 VARCHAR(36)  NOT NULL,
      name               VARCHAR(255) NOT NULL,
      type               VARCHAR(50)  NOT NULL,
      host               VARCHAR(255)     NULL,
      port               INT              NULL,
      \`database\`       VARCHAR(512)     NULL,
      username           VARCHAR(255)     NULL,
      password_encrypted TEXT             NULL,
      \`ssl\`            TINYINT(1)   NOT NULL DEFAULT 0,
      enabled            TINYINT(1)   NOT NULL DEFAULT 1,
      is_default         TINYINT(1)   NOT NULL DEFAULT 0,
      created_at         VARCHAR(32)  NOT NULL,
      updated_at         VARCHAR(32)  NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS semantic_model_versions (
      id             VARCHAR(36) NOT NULL,
      data_source_id VARCHAR(36)     NULL,
      version_number INT         NOT NULL,
      content_json   LONGTEXT    NOT NULL,
      status         VARCHAR(20) NOT NULL DEFAULT 'draft',
      created_at     VARCHAR(32) NOT NULL,
      PRIMARY KEY (id),
      KEY ix_semantic_model_versions_data_source_id (data_source_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id         VARCHAR(36)  NOT NULL,
      title      VARCHAR(300) NOT NULL DEFAULT 'New conversation',
      created_at VARCHAR(32)  NOT NULL,
      updated_at VARCHAR(32)  NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id              VARCHAR(36) NOT NULL,
      conversation_id VARCHAR(36) NOT NULL,
      role            VARCHAR(20) NOT NULL,
      content_json    LONGTEXT    NOT NULL,
      created_at      VARCHAR(32) NOT NULL,
      PRIMARY KEY (id),
      KEY ix_messages_conversation_id (conversation_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS pinned_widgets (
      id              VARCHAR(36)  NOT NULL,
      title           VARCHAR(500) NOT NULL,
      question        TEXT         NOT NULL,
      conversation_id VARCHAR(36)      NULL,
      message_id      VARCHAR(36)      NULL,
      snapshot_json   LONGTEXT     NOT NULL,
      created_at      VARCHAR(32)  NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Per-user ownership, added to databases created before it existed. Rows
  // from before then keep user_id NULL and are visible to no one.
  await addColumnIfMissing(db, "conversations", "user_id", "VARCHAR(64) NULL", "ix_conversations_user_id");
  await addColumnIfMissing(db, "pinned_widgets", "user_id", "VARCHAR(64) NULL", "ix_pinned_widgets_user_id");
  await addColumnIfMissing(db, "pinned_widgets", "sort_order", "INT NULL");
  await addIndexIfMissing(db, "pinned_widgets", "ix_pinned_widgets_conversation_id", "conversation_id");
}

/** MySQL has no `ADD COLUMN IF NOT EXISTS`, so check information_schema
 * first - safe to run on every startup. */
async function addColumnIfMissing(
  db: Pool,
  table: string,
  column: string,
  definition: string,
  indexName?: string
): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [table, column]
  );
  if (Number(rows[0]?.n ?? 0) === 0) {
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  if (indexName) await addIndexIfMissing(db, table, indexName, column);
}

async function addIndexIfMissing(db: Pool, table: string, indexName: string, column: string): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?",
    [table, indexName]
  );
  if (Number(rows[0]?.n ?? 0) === 0) {
    await db.query(`ALTER TABLE ${table} ADD INDEX ${indexName} (${column})`);
  }
}

export async function disposeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function resetDbForTests(): Promise<void> {
  await disposeDb();
}
