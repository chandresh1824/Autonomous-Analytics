export interface ColumnInfo {
  name: string;
  datatype: string;
}

export interface QueryResult {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  row_count: number;
  execution_time_ms: number;
  truncated: boolean;
}

export interface ForeignKeyInfo {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
}

/**
 * Connection-detail-agnostic query surface used by the Execution Agent.
 *
 * Agents never see hostnames, credentials or driver strings - they only call
 * `execute()` / `getSchema()` on whatever `DataSource` the registry resolved
 * for the active connection.
 */
export interface DataSource {
  testConnection(): Promise<[boolean, string]>;
  execute(sql: string, options?: { maxRows?: number; timeoutSeconds?: number }): Promise<QueryResult>;
  getSchema(): Promise<Record<string, ColumnInfo[]>>;
  getForeignKeys(): Promise<ForeignKeyInfo[]>;
  close(): Promise<void>;
}

/** Slices `rows` to at most `maxRows`, reporting whether more were available -
 * the same "ask for one extra, then trim" truncation signal the MySQL
 * datasource's `execute()` uses. */
export function capRows<T>(rows: T[], maxRows: number): { rows: T[]; truncated: boolean } {
  if (rows.length > maxRows) return { rows: rows.slice(0, maxRows), truncated: true };
  return { rows, truncated: false };
}
