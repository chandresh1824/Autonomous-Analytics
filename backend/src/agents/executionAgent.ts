import { getLogger } from "../core/logging";
import { ExecutionResult } from "../schemas/execution";
import { DataSourceRegistry } from "../services/datasource/registry";

const logger = getLogger("agents.executionAgent");

/**
 * Runs validated SQL against the data source the question was routed to and
 * returns a typed, row-capped, timing-annotated result.
 *
 * This is the only pipeline step that opens a database connection: it looks
 * up the `connections` row whose id equals the semantic model's
 * `data_source_id` (via the registry, which decrypts the stored password
 * just-in-time) and connects only then. Nothing upstream - planner, RAG
 * routing, semantic resolution, SQL generation - touches the database.
 */
export class ExecutionAgent {
  constructor(
    private readonly registry: DataSourceRegistry,
    private readonly maxRows: number,
    private readonly timeoutSeconds: number
  ) {}

  async execute(dataSourceId: string, sql: string): Promise<ExecutionResult> {
    const datasource = await this.registry.resolve(dataSourceId);
    logger.info("execution_started", { data_source_id: dataSourceId });
    const result = await datasource.execute(sql, { maxRows: this.maxRows, timeoutSeconds: this.timeoutSeconds });
    return {
      columns: result.columns.map((c) => ({ name: c.name, datatype: c.datatype })),
      rows: result.rows,
      row_count: result.row_count,
      execution_time_ms: result.execution_time_ms,
      truncated: result.truncated,
    };
  }
}
