import type { SemanticModel } from '@/types/api';

export interface SemanticFieldOption {
  /** Unique React key - not what gets stored in a filter's `field`. */
  key: string;
  /** The plain measure/dimension name to store as the filter condition's `field`. */
  fieldName: string;
  entityName: string;
  kind: 'measure' | 'dimension';
}

export interface SemanticFieldGroup {
  entityName: string;
  options: SemanticFieldOption[];
}

/** Flattens every entity's dimensions and measures into filterable field
 * options, grouped by entity (for an `<optgroup>`-style dropdown) - the same
 * "pick a real field instead of typing one" pattern `MetricQuickCreate`
 * already uses for measures, extended to cover dimensions too and to filter
 * conditions specifically. */
export function buildSemanticFieldGroups(model: SemanticModel | undefined | null): SemanticFieldGroup[] {
  if (!model) return [];
  return model.entities
    .map((entity) => ({
      entityName: entity.name,
      options: [
        ...entity.dimensions.map((dim) => ({
          key: `${entity.name}::dim::${dim.name}`,
          fieldName: dim.name,
          entityName: entity.name,
          kind: 'dimension' as const,
        })),
        ...entity.measures.map((measure) => ({
          key: `${entity.name}::measure::${measure.name}`,
          fieldName: measure.name,
          entityName: entity.name,
          kind: 'measure' as const,
        })),
      ],
    }))
    .filter((group) => group.options.length > 0);
}

/** Reasons a model can't be published yet (empty when it can) - mirrors the
 * backend's `getPublishBlockers`, which enforces the same rule on publish. */
export function getPublishBlockers(model: SemanticModel | null | undefined): string[] {
  const entities = model?.entities ?? [];
  const blockers: string[] = [];
  if (!entities.some((e) => e.dimensions.length > 0)) blockers.push('Add at least one dimension before publishing.');
  if (!entities.some((e) => e.measures.length > 0)) blockers.push('Add at least one measure before publishing.');
  return blockers;
}
