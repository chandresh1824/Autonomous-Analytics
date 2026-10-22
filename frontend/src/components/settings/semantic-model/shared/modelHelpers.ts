import type { Entity, ReferenceDefinition, SemanticModel } from '@/types/api';

/** Every column a reference (or a manually-created dimension/measure) could
 * plausibly point at on the given entity - its primary key(s) plus every
 * dimension's real SQL column, deduplicated. Scoped to entities already in
 * this semantic model (never a free-typed table/column) since a reference
 * the SQL Agent can't find declared here is indistinguishable from one that
 * doesn't exist at all - see `sql.txt`'s "Only join two tables using a
 * relationship explicitly given" rule. */
export function entityColumns(entity: Entity | undefined): string[] {
  if (!entity) return [];
  return Array.from(new Set([...entity.primary_keys, ...entity.dimensions.map((d) => d.column_name)]));
}

export function titleCase(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** A first-guess semantic datatype from the raw database type string (e.g.
 * "VARCHAR(255)", "INTEGER", "DATETIME") for a manually-added dimension -
 * purely a starting point, always overridable via the type column right
 * next to it, never written back to the database. */
export function normalizeDbDatatype(dbType: string): string {
  const t = dbType.toUpperCase();
  if (t.includes('BOOL')) return 'boolean';
  if (t.includes('DATETIME') || t.includes('TIMESTAMP')) return 'datetime';
  if (t.includes('DATE')) return 'date';
  if (t.includes('DEC') || t.includes('NUMERIC') || t.includes('FLOAT') || t.includes('DOUBLE') || t.includes('REAL')) {
    return 'decimal';
  }
  if (t.includes('INT')) return 'int';
  if (t.includes('TEXT') || t.includes('CLOB')) return 'text';
  return 'varchar';
}

export function defaultReference(model: SemanticModel, excludeEntity?: string): ReferenceDefinition {
  const target = model.entities.find((e) => e.name !== excludeEntity) ?? model.entities[0];
  const cols = entityColumns(target);
  return {
    target_entity: target?.name ?? '',
    target_key: cols[0] ?? '',
    cardinality: 'many_to_one',
    cross_filter_direction: 'single',
  };
}

export function confirmDelete(label: string): boolean {
  return window.confirm(`Remove ${label}? This cannot be undone (though you can re-add it before saving).`);
}
