import { DataSourceError } from "../../core/exceptions";
import { DataSource } from "./base";
import { MySQLDataSource } from "./mysqlDataSource";

/** The only database engine this app connects to. Kept as a named constant
 * so the connection schema, the registry and this factory all agree on the
 * exact string stored in the connections table's `type` column. */
export const MYSQL_CONNECTION_TYPE = "mysql";

export const MYSQL_DEFAULT_PORT = 3306;

export interface CreateDataSourceOptions {
  type: string;
  name: string;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  password?: string | null;
  ssl?: boolean;
}

export function createDataSource(options: CreateDataSourceOptions): DataSource {
  if (options.type.toLowerCase() !== MYSQL_CONNECTION_TYPE) {
    throw new DataSourceError(
      `Unsupported datasource type '${options.type}' - this app connects to MySQL only.`
    );
  }
  return new MySQLDataSource({
    host: options.host || "localhost",
    port: options.port || MYSQL_DEFAULT_PORT,
    database: options.database || "",
    username: options.username || "",
    password: options.password,
    ssl: options.ssl,
    name: options.name,
  });
}
