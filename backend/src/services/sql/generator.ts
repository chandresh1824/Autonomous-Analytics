import { SQLGenerationError } from "../../core/exceptions";
import { ResolvedFilter } from "../../schemas/agent";
import { Dimension, Entity, FilterCondition, FilterGroup, FilterNode, ReferenceCondition, SemanticModel } from "../../schemas/semantic";
import { SemanticResolution } from "../semantic/resolver";
import { relativeDateSql } from "./mysqlSyntax";

const OP_SQL: Record<string, string> = {
  eq: "=",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  in: "IN",
  not_in: "NOT IN",
  contains: "LIKE",
  exists: "IS NOT NULL",
  not_exists: "IS NULL",
};

const AGG_KEYWORDS = new Set(["count", "count_distinct", "sum", "avg", "min", "max"]);

function sqlLiteral(value: unknown): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `(${value.map((v) => sqlLiteral(v)).join(", ")})`;
  const escaped = String(value).replace(/'/g, "''");
  return `'${escaped}'`;
}

function isFilterGroup(node: FilterNode): node is FilterGroup {
  return node.type === "group";
}

function isReferenceCondition(node: FilterNode): node is ReferenceCondition {
  return node.type === "reference_condition";
}

/**
 * Compiles resolved semantic concepts (KPI/metric/dimensions/filters) into a
 * fully-qualified SQL query using only the table/column/relationship
 * definitions already present in the semantic model. There is no LLM
 * involved in this path, so tables, columns, joins and KPI business rules
 * can never be hallucinated - they are read directly from `SemanticModel`.
 */
export class SQLBuilder {
  private aliasMap: Record<string, string> = {};
  private joins: string[] = [];
  private referencedTables: string[] = [];
  private referencedColumns: string[] = [];

  constructor(private readonly model: SemanticModel) {}

  build(resolution: SemanticResolution, plannerFilters: ResolvedFilter[], maxRows: number): [string, string[], string[]] {
    if (resolution.metrics.length === 0) {
      return this.buildList(resolution, plannerFilters, maxRows);
    }
    return this.buildAggregate(resolution, plannerFilters, maxRows);
  }

  private buildList(resolution: SemanticResolution, plannerFilters: ResolvedFilter[], maxRows: number): [string, string[], string[]] {
    const entityName = resolution.entities[0];
    if (!entityName) throw new SQLGenerationError("No entity could be resolved for this question");
    const baseEntity = this.model.getEntity(entityName);
    if (!baseEntity) throw new SQLGenerationError(`Entity '${entityName}' is not defined in the semantic model`);

    this.aliasMap = { [baseEntity.name]: "t0" };
    this.joins = [];
    this.referencedTables = [baseEntity.table_name];
    this.referencedColumns = [];
    const baseAlias = "t0";

    const selectDims: [string, string][] = [];
    for (const dimName of resolution.dimensions) {
      const [colSql, dim] = this.columnRef(dimName);
      selectDims.push([colSql, dim.name]);
    }
    if (selectDims.length === 0) {
      const filterFieldNames = new Set(plannerFilters.map((f) => f.field.toLowerCase()));
      for (const dim of baseEntity.dimensions) {
        if (!filterFieldNames.has(dim.name.toLowerCase())) {
          selectDims.push([`${baseAlias}.${dim.column_name}`, dim.name]);
          this.referencedColumns.push(dim.column_name);
        }
      }
    }
    if (selectDims.length === 0) {
      if (baseEntity.primary_keys.length === 0) {
        throw new SQLGenerationError(
          `'${baseEntity.name}' has no primary key to fall back on and no column was requested to display for this listing question`
        );
      }
      for (const pk of baseEntity.primary_keys) {
        selectDims.push([`${baseAlias}.${pk}`, pk]);
        this.referencedColumns.push(pk);
      }
    }

    const whereClauses: string[] = [];
    for (const f of plannerFilters) {
      const [colSql] = this.columnRef(f.field);
      whereClauses.push(this.compileResolvedFilter(f, colSql));
    }

    const selectParts = selectDims.map(([expr, alias]) => `${expr} AS "${alias}"`);
    const lines = [`SELECT ${selectParts.join(", ")}`, `FROM ${baseEntity.table_name} ${baseAlias}`];
    lines.push(...this.joins);
    if (whereClauses.length) lines.push(`WHERE ${whereClauses.map((c) => `(${c})`).join(" AND ")}`);
    lines.push(`LIMIT ${maxRows}`);

    const sql = lines.join("\n");
    return [sql, dedupe(this.referencedTables), dedupe(this.referencedColumns)];
  }

  private buildAggregate(resolution: SemanticResolution, plannerFilters: ResolvedFilter[], maxRows: number): [string, string[], string[]] {
    const metric = this.model.resolveMetricOrMeasure(resolution.metrics[0]);
    if (!metric) throw new SQLGenerationError(`Metric '${resolution.metrics[0]}' is not defined in the semantic model`);

    const foundMeasure = this.model.findMeasure(metric.base_measure);
    if (!foundMeasure) throw new SQLGenerationError(`Measure '${metric.base_measure}' is not defined in the semantic model`);
    const [baseEntity, measure] = foundMeasure;

    this.aliasMap = { [baseEntity.name]: "t0" };
    this.joins = [];
    this.referencedTables = [baseEntity.table_name];
    this.referencedColumns = [];

    const selectDims: [string, string][] = [];
    for (const dimName of resolution.dimensions) {
      const [colSql, dim] = this.columnRef(dimName);
      selectDims.push([colSql, dim.name]);
    }

    const baseAlias = this.aliasMap[baseEntity.name];
    const measureSql = this.aggregate(measure.aggregation, `${baseAlias}.${measure.expression}`);
    this.referencedColumns.push(measure.expression);

    const whereClauses: string[] = [];
    const kpi = resolution.kpis.length ? this.model.getKpi(resolution.kpis[0]) : null;
    if (kpi?.default_filter_logic) {
      whereClauses.push(this.compileNode(kpi.default_filter_logic, baseEntity, baseAlias));
    }
    for (const cond of metric.filters ?? []) {
      whereClauses.push(this.compileNode(cond, baseEntity, baseAlias));
    }
    for (const f of plannerFilters) {
      const [colSql] = this.columnRef(f.field);
      whereClauses.push(this.compileResolvedFilter(f, colSql));
    }

    let orderSql = `${measureSql} DESC`;
    let limit = maxRows;
    if (resolution.sort_rank) {
      const direction = resolution.sort_rank.direction === "asc" ? "ASC" : "DESC";
      const sortField = resolution.sort_rank.field;
      if (sortField.toLowerCase() === metric.name.toLowerCase()) {
        orderSql = `${measureSql} ${direction}`;
      } else {
        try {
          const [sortColSql] = this.columnRef(sortField);
          orderSql = `${sortColSql} ${direction}`;
        } catch (exc) {
          if (!(exc instanceof SQLGenerationError)) throw exc;
          orderSql = `${measureSql} ${direction}`;
        }
      }
      if (resolution.sort_rank.limit != null) {
        limit = Math.min(resolution.sort_rank.limit, maxRows);
      }
    }

    const selectParts = selectDims.map(([expr, alias]) => `${expr} AS "${alias}"`);
    selectParts.push(`${measureSql} AS "${metric.name}"`);

    const lines = [`SELECT ${selectParts.join(", ")}`, `FROM ${baseEntity.table_name} ${baseAlias}`];
    lines.push(...this.joins);
    if (whereClauses.length) lines.push(`WHERE ${whereClauses.map((c) => `(${c})`).join(" AND ")}`);
    if (selectDims.length) {
      lines.push(`GROUP BY ${selectDims.map(([expr]) => expr).join(", ")}`);
      lines.push(`ORDER BY ${orderSql}`);
    }
    lines.push(`LIMIT ${limit}`);

    const sql = lines.join("\n");
    return [sql, dedupe(this.referencedTables), dedupe(this.referencedColumns)];
  }

  private ensureJoined(entity: Entity): string {
    if (this.aliasMap[entity.name]) return this.aliasMap[entity.name];

    for (const [knownEntityName, knownAlias] of Object.entries(this.aliasMap)) {
      const knownEntity = this.model.getEntity(knownEntityName);
      if (!knownEntity) continue;
      for (const dim of knownEntity.dimensions) {
        if (dim.reference && dim.reference.target_entity === entity.name) {
          const newAlias = `t${Object.keys(this.aliasMap).length}`;
          this.aliasMap[entity.name] = newAlias;
          this.joins.push(`LEFT JOIN ${entity.table_name} ${newAlias} ON ${newAlias}.${dim.reference.target_key} = ${knownAlias}.${dim.column_name}`);
          this.referencedTables.push(entity.table_name);
          return newAlias;
        }
      }
    }

    for (const dim of entity.dimensions) {
      if (dim.reference && this.aliasMap[dim.reference.target_entity]) {
        const knownAlias = this.aliasMap[dim.reference.target_entity];
        const newAlias = `t${Object.keys(this.aliasMap).length}`;
        this.aliasMap[entity.name] = newAlias;
        this.joins.push(`LEFT JOIN ${entity.table_name} ${newAlias} ON ${knownAlias}.${dim.reference.target_key} = ${newAlias}.${dim.column_name}`);
        this.referencedTables.push(entity.table_name);
        return newAlias;
      }
    }

    throw new SQLGenerationError(`No relationship is defined between '${entity.name}' and the entities already used in this query`);
  }

  private columnRef(dimName: string): [string, Dimension] {
    const found = this.model.findDimension(dimName);
    if (!found) throw new SQLGenerationError(`Dimension '${dimName}' is not defined in the semantic model`);
    const [entity, dim] = found;
    const alias = this.ensureJoined(entity);
    this.referencedColumns.push(dim.column_name);
    return [`${alias}.${dim.column_name}`, dim];
  }

  private compileNode(node: FilterNode, baseEntity: Entity, baseAlias: string): string {
    if (isFilterGroup(node)) {
      const parts = node.children.map((child) => this.compileNode(child, baseEntity, baseAlias));
      const joiner = ` ${node.operator} `;
      return parts.map((p) => `(${p})`).join(joiner);
    }
    if (isReferenceCondition(node)) {
      return this.compileReferenceCondition(node, baseEntity, baseAlias);
    }
    return this.compileCondition(node as FilterCondition);
  }

  private compileCondition(cond: FilterCondition): string {
    const [colSql] = this.columnRef(cond.field);
    const opSql = OP_SQL[cond.op] ?? "=";
    if (cond.op === "contains") {
      return `${colSql} LIKE ${sqlLiteral(`%${cond.value}%`)}`;
    }
    return `${colSql} ${opSql} ${sqlLiteral(cond.value)}`;
  }

  private compileReferenceCondition(cond: ReferenceCondition, _baseEntity: Entity, _baseAlias: string): string {
    const found = this.model.findDimension(cond.reference);
    if (!found) throw new SQLGenerationError(`Reference condition points to unknown dimension '${cond.reference}'`);
    const [, refDim] = found;
    if (!refDim.reference) throw new SQLGenerationError(`Dimension '${refDim.name}' has no relationship defined for a reference condition`);
    const targetEntity = this.model.getEntity(refDim.reference.target_entity);
    if (!targetEntity) throw new SQLGenerationError(`Unknown reference target entity '${refDim.reference.target_entity}'`);

    const innerFound = this.model.findDimension(cond.field);
    if (!innerFound) throw new SQLGenerationError(`Reference condition field '${cond.field}' is not defined`);
    const [innerEntity, innerDim] = innerFound;
    if (innerEntity.name !== targetEntity.name) {
      throw new SQLGenerationError("Reference condition field must belong to the referenced target entity");
    }

    const [refCol] = this.columnRef(refDim.name);
    this.referencedTables.push(targetEntity.table_name);
    const subAlias = `rc${this.joins.length + 1}`;
    const opSql = OP_SQL[cond.op] ?? "=";
    const predicate = `${subAlias}.${innerDim.column_name} ${opSql} ${sqlLiteral(cond.value)}`;
    const subquery = `SELECT 1 FROM ${targetEntity.table_name} ${subAlias} WHERE ${subAlias}.${refDim.reference.target_key} = ${refCol} AND ${predicate}`;
    const prefix = cond.match === "not_exists" ? "NOT EXISTS" : "EXISTS";
    return `${prefix} (${subquery})`;
  }

  private compileResolvedFilter(f: ResolvedFilter, colSql: string): string {
    const op = f.op;
    if (op === "last_n_months") return `${colSql} >= ${relativeDateSql(Number(f.value), "months")}`;
    if (op === "last_n_days") return `${colSql} >= ${relativeDateSql(Number(f.value), "days")}`;
    if (op === "last_n_years") return `${colSql} >= ${relativeDateSql(Number(f.value), "years")}`;
    if (op === "between" && Array.isArray(f.value) && f.value.length === 2) {
      return `${colSql} BETWEEN ${sqlLiteral(f.value[0])} AND ${sqlLiteral(f.value[1])}`;
    }
    if (op === "contains") {
      return `${colSql} LIKE ${sqlLiteral(`%${f.value}%`)}`;
    }
    const opSql = OP_SQL[op] ?? "=";
    return `${colSql} ${opSql} ${sqlLiteral(f.value)}`;
  }

  private aggregate(aggregation: string, columnSql: string): string {
    const agg = aggregation.toLowerCase();
    if (!AGG_KEYWORDS.has(agg)) throw new SQLGenerationError(`Unsupported aggregation '${aggregation}'`);
    if (agg === "count_distinct") return `COUNT(DISTINCT ${columnSql})`;
    return `${agg.toUpperCase()}(${columnSql})`;
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
