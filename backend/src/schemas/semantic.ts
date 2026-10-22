import { z } from "zod";
import { SemanticModelError } from "../core/exceptions";

export const ReferenceDefinitionSchema = z.object({
  target_entity: z.string(),
  target_key: z.string(),
  cardinality: z.string().default("many_to_one"),
  role: z.string().nullable().default(null),
  // Power BI-style single/both direction filtering metadata. Purely
  // descriptive - the SQL Agent always compiles a relationship as a plain
  // equi-join for whatever the resolved question needs, the same way
  // `cardinality` above is already stored but never consulted there.
  cross_filter_direction: z.string().default("single"),
});
export type ReferenceDefinition = z.infer<typeof ReferenceDefinitionSchema>;

export const DimensionSchema = z.object({
  name: z.string(),
  column_name: z.string(),
  datatype: z.string(),
  description: z.string().default(""),
  synonyms: z.array(z.string()).default([]),
  reference: ReferenceDefinitionSchema.nullable().default(null),
});
export type Dimension = z.infer<typeof DimensionSchema>;

export const MeasureSchema = z.object({
  name: z.string(),
  expression: z.string(),
  aggregation: z.string(),
  datatype: z.string(),
  format: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  synonyms: z.array(z.string()).default([]),
});
export type Measure = z.infer<typeof MeasureSchema>;

export const EntitySchema = z.object({
  name: z.string(),
  table_name: z.string(),
  description: z.string().default(""),
  primary_keys: z.array(z.string()).default([]),
  dimensions: z.array(DimensionSchema).default([]),
  measures: z.array(MeasureSchema).default([]),
});
export type Entity = z.infer<typeof EntitySchema>;

export const FilterConditionSchema = z.object({
  type: z.literal("condition").default("condition"),
  field: z.string(),
  op: z.string(),
  value: z.any().nullable().default(null),
});
export type FilterCondition = z.infer<typeof FilterConditionSchema>;

export const ReferenceConditionSchema = z.object({
  type: z.literal("reference_condition").default("reference_condition"),
  reference: z.string(),
  match: z.enum(["exists", "not_exists"]),
  field: z.string(),
  op: z.string(),
  value: z.any().nullable().default(null),
});
export type ReferenceCondition = z.infer<typeof ReferenceConditionSchema>;

export type FilterNode = FilterCondition | ReferenceCondition | FilterGroup;
export interface FilterGroup {
  type: "group";
  operator: "AND" | "OR";
  children: FilterNode[];
}

// `FilterGroupSchema` itself must stay a plain (non-lazy) ZodObject, not
// `z.lazy(...)` - `z.discriminatedUnion` below inspects each member's
// `.shape` synchronously at schema-construction time to build its
// discriminator lookup table, which a `ZodLazy` wrapper doesn't expose
// (it only resolves to the real object schema later, at parse time),
// crashing with "Cannot read properties of undefined (reading 'type')".
// The actual self-reference (`children: FilterNode[]`) is instead deferred
// one level down, via `z.lazy()` on the *array element* schema - by the
// time that thunk runs (at parse time), `FilterNodeSchema` below is already
// a real value. Annotated with a permissive (`any`) Input type parameter -
// only the Output shape (`FilterGroup`) needs to be exact for callers;
// pinning down the Input type too (which, thanks to `.default()`, has every
// field optional) creates an unsatisfiable Output/Input conflict against
// the recursive `FilterNode` union.
const filterGroupObject = z.object({
  type: z.literal("group").default("group"),
  operator: z.enum(["AND", "OR"]).default("AND"),
  children: z.array(z.lazy((): z.ZodTypeAny => FilterNodeSchema)).default([]),
});

export const FilterNodeSchema: z.ZodType<FilterNode, z.ZodTypeDef, any> = z.discriminatedUnion("type", [
  FilterConditionSchema,
  ReferenceConditionSchema,
  filterGroupObject,
]);

export const FilterGroupSchema: z.ZodType<FilterGroup, z.ZodTypeDef, any> = filterGroupObject;

export const MetricSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  base_measure: z.string(),
  filters: z.array(FilterConditionSchema).default([]),
  filter_logic: FilterGroupSchema.nullable().default(null),
  supported_dimensions: z.array(z.string()).default([]),
  format: z.string().nullable().default(null),
});
export type Metric = z.infer<typeof MetricSchema>;

export const KPISchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  formula: z.string(),
  metric_ids: z.array(z.string()).default([]),
  required_grouping_dimensions: z.array(z.string()).default([]),
  supported_dimensions: z.array(z.string()).default([]),
  default_filters: z.array(FilterConditionSchema).default([]),
  default_filter_logic: FilterGroupSchema.nullable().default(null),
  enabled: z.boolean().default(true),
});
export type KPI = z.infer<typeof KPISchema>;

export const SemanticModelDataSchema = z.object({
  version: z.string().default("1.0.0"),
  data_source_id: z.string().nullable().default(null),
  entities: z.array(EntitySchema).default([]),
  metrics: z.array(MetricSchema).default([]),
  kpis: z.array(KPISchema).default([]),
});
export type SemanticModelData = z.infer<typeof SemanticModelDataSchema>;

/** Thin wrapper around the parsed data adding the lookup helpers the Python
 * `SemanticModel` pydantic model exposed as methods - kept as a class (not
 * free functions) so call sites read the same way the original code did. */
export class SemanticModel {
  version: string;
  data_source_id: string | null;
  entities: Entity[];
  metrics: Metric[];
  kpis: KPI[];

  constructor(data: SemanticModelData) {
    this.version = data.version;
    this.data_source_id = data.data_source_id;
    this.entities = data.entities;
    this.metrics = data.metrics;
    this.kpis = data.kpis;
    this.validateReferences();
  }

  private validateReferences(): void {
    const entityNames = new Set(this.entities.map((e) => e.name));
    for (const entity of this.entities) {
      for (const dim of entity.dimensions) {
        if (dim.reference && !entityNames.has(dim.reference.target_entity)) {
          throw new SemanticModelError(
            `Dimension '${dim.name}' on entity '${entity.name}' references unknown entity '${dim.reference.target_entity}'`
          );
        }
      }
    }
    const metricIds = new Set(this.metrics.map((m) => m.id));
    for (const kpi of this.kpis) {
      for (const metricId of kpi.metric_ids) {
        if (!metricIds.has(metricId)) {
          throw new SemanticModelError(`KPI '${kpi.name}' references unknown metric id '${metricId}'`);
        }
      }
    }
    const measureNames = new Set(this.entities.flatMap((e) => e.measures.map((m) => m.name)));
    for (const metric of this.metrics) {
      if (!measureNames.has(metric.base_measure)) {
        throw new SemanticModelError(`Metric '${metric.name}' references unknown measure '${metric.base_measure}'`);
      }
    }
  }

  toJSON(): SemanticModelData {
    return {
      version: this.version,
      data_source_id: this.data_source_id,
      entities: this.entities,
      metrics: this.metrics,
      kpis: this.kpis,
    };
  }

  copyWith(update: Partial<SemanticModelData>): SemanticModel {
    return new SemanticModel({ ...this.toJSON(), ...update });
  }

  getEntity(name: string): Entity | null {
    return this.entities.find((e) => e.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  getEntityByTable(tableName: string): Entity | null {
    return this.entities.find((e) => e.table_name.toLowerCase() === tableName.toLowerCase()) ?? null;
  }

  /** Resolve a bare or 'Entity::Dimension' qualified dimension name. */
  findDimension(name: string): [Entity, Dimension] | null {
    if (name.includes("::")) {
      const [entityName, dimName] = name.split("::", 2);
      const entity = this.getEntity(entityName);
      if (!entity) return null;
      const dim = entity.dimensions.find((d) => d.name.toLowerCase() === dimName.toLowerCase());
      return dim ? [entity, dim] : null;
    }
    for (const entity of this.entities) {
      for (const dim of entity.dimensions) {
        if (dim.name.toLowerCase() === name.toLowerCase()) return [entity, dim];
      }
    }
    return null;
  }

  findDimensionBySynonym(text: string): [Entity, Dimension] | null {
    const textLower = text.toLowerCase().trim();
    for (const entity of this.entities) {
      for (const dim of entity.dimensions) {
        if (dim.name.toLowerCase() === textLower) return [entity, dim];
        if (dim.synonyms.some((s) => s.toLowerCase() === textLower)) return [entity, dim];
      }
    }
    return null;
  }

  findMeasure(name: string): [Entity, Measure] | null {
    for (const entity of this.entities) {
      for (const measure of entity.measures) {
        if (measure.name.toLowerCase() === name.toLowerCase()) return [entity, measure];
      }
    }
    return null;
  }

  getMetric(name: string): Metric | null {
    return this.metrics.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  getMetricById(metricId: string): Metric | null {
    return this.metrics.find((m) => m.id === metricId) ?? null;
  }

  /** Looks up `name` as a real Metric first; if none exists but a bare
   * Measure of that name is defined directly on some entity, wraps it in an
   * ad-hoc Metric (its own name as `base_measure`, no extra filters) so
   * every metric-consuming code path can treat a plain aggregatable measure
   * exactly like a fully-defined Metric, without one ever having to be
   * hand-authored for it. */
  resolveMetricOrMeasure(name: string): Metric | null {
    const metric = this.getMetric(name);
    if (metric) return metric;
    const found = this.findMeasure(name);
    if (!found) return null;
    const [entity, measure] = found;
    return {
      id: `measure::${entity.name}::${measure.name}`,
      name: measure.name,
      description: measure.description || "",
      base_measure: measure.name,
      filters: [],
      filter_logic: null,
      supported_dimensions: entity.dimensions.map((d) => d.name),
      format: measure.format,
    };
  }

  getKpi(name: string): KPI | null {
    return this.kpis.find((k) => k.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  getKpiById(kpiId: string): KPI | null {
    return this.kpis.find((k) => k.id === kpiId) ?? null;
  }

  allDimensionNames(): string[] {
    return this.entities.flatMap((e) => e.dimensions.map((d) => d.name));
  }

  allKpiNames(): string[] {
    return this.kpis.filter((k) => k.enabled).map((k) => k.name);
  }
}
