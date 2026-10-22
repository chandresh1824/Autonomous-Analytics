import type { Dimension, Entity, KPI, Measure, Metric, SemanticModel } from '@/types/api';

export type ChangeKind = 'added' | 'modified' | 'removed';

export interface FieldChange {
  label: string;
  before: string;
  after: string;
}

export interface ModelChange {
  key: string;
  kind: ChangeKind;
  name: string;
  /** Secondary label: the owning entity for dimensions/measures, the id for metrics/KPIs. */
  detail?: string;
  fields: FieldChange[];
  /** Returns `draft` with just this change put back to the published model. */
  revert: (draft: SemanticModel) => SemanticModel;
}

export interface DraftChanges {
  entities: ModelChange[];
  dimensions: ModelChange[];
  measures: ModelChange[];
  metrics: ModelChange[];
  kpis: ModelChange[];
  total: number;
}

export const CHANGE_SECTIONS: { key: keyof Omit<DraftChanges, 'total'>; title: string }[] = [
  { key: 'entities', title: 'Entities' },
  { key: 'dimensions', title: 'Dimensions' },
  { key: 'measures', title: 'Measures' },
  { key: 'metrics', title: 'Metrics' },
  { key: 'kpis', title: 'KPIs' },
];

const ENTITY_FIELDS: [keyof Entity, string][] = [
  ['table_name', 'Table'],
  ['description', 'Description'],
  ['primary_keys', 'Primary keys'],
];

const DIMENSION_FIELDS: [keyof Dimension, string][] = [
  ['column_name', 'Column'],
  ['datatype', 'Datatype'],
  ['description', 'Description'],
  ['synonyms', 'Synonyms'],
  ['reference', 'Relationship'],
];

const MEASURE_FIELDS: [keyof Measure, string][] = [
  ['expression', 'Expression'],
  ['aggregation', 'Aggregation'],
  ['datatype', 'Datatype'],
  ['format', 'Format'],
  ['description', 'Description'],
  ['synonyms', 'Synonyms'],
];

const METRIC_FIELDS: [keyof Metric, string][] = [
  ['name', 'Name'],
  ['description', 'Description'],
  ['base_measure', 'Base measure'],
  ['filters', 'Filters'],
  ['filter_logic', 'Filter logic'],
  ['supported_dimensions', 'Supported dimensions'],
  ['format', 'Format'],
];

const KPI_FIELDS: [keyof KPI, string][] = [
  ['name', 'Name'],
  ['description', 'Description'],
  ['formula', 'Formula'],
  ['metric_ids', 'Metrics'],
  ['required_grouping_dimensions', 'Required grouping dimensions'],
  ['supported_dimensions', 'Supported dimensions'],
  ['default_filters', 'Default filters'],
  ['default_filter_logic', 'Default filter logic'],
  ['enabled', 'Enabled'],
];

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return value.length ? value.join(', ') : '—';
  }
  if (Array.isArray(value) && value.length === 0) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function fieldChanges<T>(before: T, after: T, fields: [keyof T, string][]): FieldChange[] {
  return fields
    .filter(([key]) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map(([key, label]) => ({ label, before: formatValue(before[key]), after: formatValue(after[key]) }));
}

/**
 * Diffs a keyed list, producing one change per added/modified/removed item.
 * `replace` swaps the whole list on a model, so each change can revert
 * itself: dropping an added item, restoring a removed one, or putting a
 * modified one back to its published copy.
 */
function diffList<T>(
  draftItems: T[],
  publishedItems: T[],
  opts: {
    keyOf: (item: T) => string;
    nameOf: (item: T) => string;
    detailOf?: (item: T) => string | undefined;
    fields: [keyof T, string][];
    keyPrefix: string;
    get: (model: SemanticModel) => T[];
    replace: (model: SemanticModel, items: T[]) => SemanticModel;
  },
): ModelChange[] {
  const { keyOf, nameOf, detailOf, fields, keyPrefix, get, replace } = opts;
  const publishedByKey = new Map(publishedItems.map((item) => [keyOf(item), item]));
  const draftKeys = new Set(draftItems.map(keyOf));
  const changes: ModelChange[] = [];

  for (const item of draftItems) {
    const id = keyOf(item);
    const before = publishedByKey.get(id);
    const base = { key: `${keyPrefix}:${id}`, name: nameOf(item), detail: detailOf?.(item) };
    if (!before) {
      changes.push({
        ...base,
        kind: 'added',
        fields: [],
        revert: (d) => replace(d, get(d).filter((i) => keyOf(i) !== id)),
      });
      continue;
    }
    const changed = fieldChanges(before, item, fields);
    if (changed.length) {
      changes.push({
        ...base,
        kind: 'modified',
        fields: changed,
        revert: (d) => replace(d, get(d).map((i) => (keyOf(i) === id ? before : i))),
      });
    }
  }
  publishedItems.forEach((item, index) => {
    const id = keyOf(item);
    if (draftKeys.has(id)) return;
    changes.push({
      key: `${keyPrefix}:${id}`,
      kind: 'removed',
      name: nameOf(item),
      detail: detailOf?.(item),
      fields: [],
      revert: (d) => replace(d, insertAt(get(d), item, index)),
    });
  });
  return changes;
}

/** Puts a restored item back at its published position rather than the end,
 * so a fully reverted draft matches the published model exactly. */
function insertAt<T>(items: T[], item: T, index: number): T[] {
  const next = [...items];
  next.splice(Math.min(index, next.length), 0, item);
  return next;
}

function entityOf(model: SemanticModel, name: string): Entity | undefined {
  return model.entities.find((e) => e.name === name);
}

function withEntity(model: SemanticModel, name: string, fn: (entity: Entity) => Entity): SemanticModel {
  return { ...model, entities: model.entities.map((e) => (e.name === name ? fn(e) : e)) };
}

/**
 * Compares the working (draft) model against the published one, across
 * every part of the model. A missing published model counts as empty, so
 * everything in the draft is "added". Dimensions and measures are only
 * listed for entities present in both - an added/removed entity is one
 * change covering everything in it.
 */
export function computeDraftChanges(
  draft: SemanticModel | undefined,
  published: SemanticModel | undefined,
): DraftChanges {
  const changes: DraftChanges = { entities: [], dimensions: [], measures: [], metrics: [], kpis: [], total: 0 };
  if (!draft) return changes;
  const publishedEntities = published?.entities ?? [];
  const publishedByName = new Map(publishedEntities.map((e) => [e.name, e]));
  const draftNames = new Set(draft.entities.map((e) => e.name));

  for (const entity of draft.entities) {
    const before = publishedByName.get(entity.name);
    if (!before) {
      changes.entities.push({
        key: `entity:${entity.name}`,
        kind: 'added',
        name: entity.name,
        detail: entity.table_name,
        fields: [
          { label: 'Dimensions', before: '—', after: String(entity.dimensions.length) },
          { label: 'Measures', before: '—', after: String(entity.measures.length) },
        ],
        revert: (d) => ({ ...d, entities: d.entities.filter((e) => e.name !== entity.name) }),
      });
      continue;
    }
    const changed = fieldChanges(before, entity, ENTITY_FIELDS);
    if (changed.length) {
      changes.entities.push({
        key: `entity:${entity.name}`,
        kind: 'modified',
        name: entity.name,
        detail: entity.table_name,
        fields: changed,
        // Entity-level fields only - its dimensions/measures revert separately.
        revert: (d) =>
          withEntity(d, entity.name, (e) => ({
            ...e,
            table_name: before.table_name,
            description: before.description,
            primary_keys: before.primary_keys,
          })),
      });
    }
    changes.dimensions.push(
      ...diffList(entity.dimensions, before.dimensions, {
        keyOf: (dim) => dim.name,
        nameOf: (dim) => dim.name,
        detailOf: () => entity.name,
        fields: DIMENSION_FIELDS,
        keyPrefix: `dimension:${entity.name}`,
        get: (m) => entityOf(m, entity.name)?.dimensions ?? [],
        replace: (m, dimensions) => withEntity(m, entity.name, (e) => ({ ...e, dimensions })),
      }),
    );
    changes.measures.push(
      ...diffList(entity.measures, before.measures, {
        keyOf: (measure) => measure.name,
        nameOf: (measure) => measure.name,
        detailOf: () => entity.name,
        fields: MEASURE_FIELDS,
        keyPrefix: `measure:${entity.name}`,
        get: (m) => entityOf(m, entity.name)?.measures ?? [],
        replace: (m, measures) => withEntity(m, entity.name, (e) => ({ ...e, measures })),
      }),
    );
  }
  publishedEntities.forEach((entity, index) => {
    if (draftNames.has(entity.name)) return;
    changes.entities.push({
      key: `entity:${entity.name}`,
      kind: 'removed',
      name: entity.name,
      detail: entity.table_name,
      fields: [],
      revert: (d) => ({ ...d, entities: insertAt(d.entities, entity, index) }),
    });
  });

  changes.metrics = diffList(draft.metrics ?? [], published?.metrics ?? [], {
    keyOf: (metric) => metric.id,
    nameOf: (metric) => metric.name,
    detailOf: (metric) => metric.id,
    fields: METRIC_FIELDS,
    keyPrefix: 'metric',
    get: (m) => m.metrics ?? [],
    replace: (m, metrics) => ({ ...m, metrics }),
  });
  changes.kpis = diffList(draft.kpis ?? [], published?.kpis ?? [], {
    keyOf: (kpi) => kpi.id,
    nameOf: (kpi) => kpi.name,
    detailOf: (kpi) => kpi.id,
    fields: KPI_FIELDS,
    keyPrefix: 'kpi',
    get: (m) => m.kpis ?? [],
    replace: (m, kpis) => ({ ...m, kpis }),
  });

  changes.total = CHANGE_SECTIONS.reduce((sum, section) => sum + changes[section.key].length, 0);
  return changes;
}
