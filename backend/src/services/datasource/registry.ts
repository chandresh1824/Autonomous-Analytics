import { DataSourceError } from "../../core/exceptions";
import { getLogger } from "../../core/logging";
import { decryptSecret } from "../../core/security";
import { ConnectionRepository } from "../../repositories/connectionRepository";
import { ConnectionRow } from "../../repositories/models";
import { DataSource } from "./base";
import { createDataSource } from "./factory";

const logger = getLogger("services.datasource.registry");

/**
 * Decrypts a connection's stored password just-in-time for connecting. The
 * plaintext is only ever handed to the driver - never cached, logged or
 * returned to a client. A ciphertext that won't decrypt almost always means
 * SECRET_KEY changed since the password was saved (e.g. local dev and Docker
 * sharing one app database with different keys), so say that instead of
 * surfacing the raw GCM auth error.
 */
export function decryptConnectionPassword(connection: ConnectionRow): string | null {
  if (!connection.password_encrypted) return null;
  try {
    return decryptSecret(connection.password_encrypted);
  } catch (exc) {
    logger.error("connection_password_decrypt_failed", { connection_id: connection.id, error: String(exc) });
    throw new DataSourceError(
      `The saved password for '${connection.name}' could not be decrypted - the server's SECRET_KEY has ` +
        "changed since it was saved. Edit the connection and re-enter its password."
    );
  }
}

/**
 * Resolves a connection id (or the default enabled connection) to a live
 * `DataSource`, caching engines across calls so a chat conversation reuses
 * the same connection pool instead of reconnecting every turn.
 */
export class DataSourceRegistry {
  private readonly cache = new Map<string, DataSource>();

  constructor(private readonly connectionRepository: ConnectionRepository) {}

  /**
   * Connects to the connection whose id is `connectionId` (a connection's id
   * doubles as its semantic model's `data_source_id`). Deliberately requires
   * an explicit id - there is no fallback to a default connection, so a query
   * can only ever run against the data source it was resolved for.
   */
  async resolve(connectionId: string): Promise<DataSource> {
    if (!connectionId) {
      throw new DataSourceError("No data source id was given - refusing to fall back to a default connection.");
    }
    const connection = await this.connectionRepository.resolve(connectionId);

    const cached = this.cache.get(connection.id);
    if (cached) return cached;

    const password = decryptConnectionPassword(connection);
    const datasource = createDataSource({
      type: connection.type,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password,
      ssl: Boolean(connection.ssl),
    });
    this.cache.set(connection.id, datasource);
    return datasource;
  }

  async invalidate(connectionId: string): Promise<void> {
    const datasource = this.cache.get(connectionId);
    if (datasource) {
      this.cache.delete(connectionId);
      await datasource.close();
    }
  }

  /** Closes every datasource this registry resolved, so a per-request
   * engine/connection never outlives the request that created it. */
  async closeAll(): Promise<void> {
    for (const datasource of this.cache.values()) {
      try {
        await datasource.close();
      } catch (exc) {
        logger.warning("datasource_close_failed", { error: String(exc) });
      }
    }
    this.cache.clear();
  }
}
