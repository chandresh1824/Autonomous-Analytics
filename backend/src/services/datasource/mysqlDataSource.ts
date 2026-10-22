import mysql, { Pool } from "mysql2/promise";
import { SQLExecutionError } from "../../core/exceptions";
import { getLogger } from "../../core/logging";
import { capRows, ColumnInfo, DataSource, ForeignKeyInfo, QueryResult } from "./base";

const logger = getLogger("services.datasource.mysql");

export interface MySQLOptions {
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string | null;
  ssl?: boolean;
  name?: string;
}

export class MySQLDataSource implements DataSource {
  private pool: Pool | null = null;
  private readonly name: string;

  constructor(private readonly options: MySQLOptions) {
    this.name = options.name ?? "mysql";
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = mysql.createPool({
        host: this.options.host,
        port: this.options.port,
        database: this.options.database,
        user: this.options.username,
        password: this.options.password ?? undefined,
        ssl: this.options.ssl ? {} : undefined,
        timezone: "Z",
      });
    }
    return this.pool;
  }

  async testConnection(): Promise<[boolean, string]> {
    try {
      const pool = this.getPool();
      await pool.query("SELECT 1");
      return [true, "Connection successful"];
    } catch (exc) {
      logger.warning("datasource_test_failed", { datasource: this.name, error: String(exc) });
      return [false, `Unable to reach the datasource with the given settings: ${String(exc)}`];
    }
  }

  async execute(sql: string, options: { maxRows?: number; timeoutSeconds?: number } = {}): Promise<QueryResult> {
    const { maxRows = 1000, timeoutSeconds = 30 } = options;
    const pool = this.getPool();
    const start = performance.now();
    try {
      const [rows, fields] = await pool.query({ sql, timeout: Math.round(timeoutSeconds * 1000) });
      const rowArray = rows as Record<string, unknown>[];
      const columnNames = (fields ?? []).map((f) => f.name);
      const { rows: cappedRows, truncated } = capRows(rowArray, maxRows);
      const elapsedMs = performance.now() - start;
      const columns: ColumnInfo[] = (columnNames.length ? columnNames : Object.keys(rowArray[0] ?? {})).map((name) => ({
        name,
        datatype: "unknown",
      }));
      return { columns, rows: cappedRows, row_count: cappedRows.length, execution_time_ms: elapsedMs, truncated };
    } catch (exc) {
      logger.error("datasource_execute_failed", { datasource: this.name, error: String(exc) });
      throw new SQLExecutionError("The query could not be executed against the datasource");
    }
  }

  async getSchema(): Promise<Record<string, ColumnInfo[]>> {
    const pool = this.getPool();
    const [tableRows] = await pool.query<any[]>(
      "SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name"
    );
    const schema: Record<string, ColumnInfo[]> = {};
    for (const row of tableRows as { table_name: string }[]) {
      const tableName = row.table_name;
      const [columnRows] = await pool.query<any[]>(
        "SELECT column_name AS column_name, data_type AS data_type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position",
        [tableName]
      );
      schema[tableName] = (columnRows as { column_name: string; data_type: string }[]).map((c) => ({
        name: c.column_name,
        datatype: c.data_type,
      }));
    }
    return schema;
  }

  async getForeignKeys(): Promise<ForeignKeyInfo[]> {
    const pool = this.getPool();
    const [rows] = await pool.query<any[]>(
      `SELECT k.table_name AS table_name, k.column_name AS column_name,
              k.referenced_table_name AS referenced_table_name,
              k.referenced_column_name AS referenced_column_name,
              (SELECT COUNT(*) FROM information_schema.key_column_usage k2
                 WHERE k2.constraint_name = k.constraint_name AND k2.table_schema = k.table_schema) AS column_count
       FROM information_schema.key_column_usage k
       WHERE k.table_schema = DATABASE() AND k.referenced_table_name IS NOT NULL`
    );
    return (rows as { table_name: string; column_name: string; referenced_table_name: string; referenced_column_name: string; column_count: number }[])
      .filter((row) => Number(row.column_count) === 1)
      .map((row) => ({
        from_table: row.table_name,
        from_column: row.column_name,
        to_table: row.referenced_table_name,
        to_column: row.referenced_column_name,
      }));
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
