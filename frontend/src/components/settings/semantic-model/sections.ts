import type { IconName } from '@/components/common/Icon';
import type { SemanticModel } from '@/types/api';
import type { DraftChanges } from './draft/draftChanges';

export type SemanticModelSectionKey =
  | 'entities'
  | 'dimensions'
  | 'measures'
  | 'relationships'
  | 'synonyms'
  | 'metrics'
  | 'kpis'
  | 'json';

/** Colour family for a group - each group's sections share its colour so
 * the data model, business logic, and advanced areas read apart at a glance. */
export type SectionTone = 'model' | 'logic' | 'advanced';

export interface SemanticModelSection {
  key: SemanticModelSectionKey;
  label: string;
  description: string;
  icon: IconName;
  tone: SectionTone;
}

export interface SemanticModelSectionGroup {
  label: string;
  tone: SectionTone;
  sections: SemanticModelSection[];
}

const GROUPS: (Omit<SemanticModelSectionGroup, 'sections'> & {
  sections: Omit<SemanticModelSection, 'tone'>[];
})[] = [
  {
    label: 'Data model',
    tone: 'model',
    sections: [
      {
        key: 'entities',
        label: 'Entities',
        icon: 'table',
        description: 'The database tables the agent can query, with their keys.',
      },
      {
        key: 'dimensions',
        label: 'Dimensions',
        icon: 'tag',
        description: 'Columns used to group, filter, and describe data.',
      },
      {
        key: 'measures',
        label: 'Measures',
        icon: 'sigma',
        description: 'Aggregations such as sums, counts, and averages.',
      },
      {
        key: 'relationships',
        label: 'Relationships',
        icon: 'link',
        description: 'How entities join to each other.',
      },
      {
        key: 'synonyms',
        label: 'Synonyms',
        icon: 'text',
        description: 'Alternative names users may use for dimensions and measures.',
      },
    ],
  },
  {
    label: 'Business logic',
    tone: 'logic',
    sections: [
      {
        key: 'metrics',
        label: 'Metrics',
        icon: 'chart',
        description: 'Reusable measures with optional default filters.',
      },
      {
        key: 'kpis',
        label: 'KPIs',
        icon: 'target',
        description: 'Business KPIs built from metrics, which the agent can reference in answers.',
      },
    ],
  },
  {
    label: 'Advanced',
    tone: 'advanced',
    sections: [
      {
        key: 'json',
        label: 'JSON',
        icon: 'code',
        description: 'The full model as JSON, for review, export, or bulk edits.',
      },
    ],
  },
];

export const SECTION_GROUPS: SemanticModelSectionGroup[] = GROUPS.map((group) => ({
  ...group,
  sections: group.sections.map((section) => ({ ...section, tone: group.tone })),
}));

export const ALL_SECTIONS: SemanticModelSection[] = SECTION_GROUPS.flatMap((group) => group.sections);

export function isSemanticModelSection(key: unknown): key is SemanticModelSectionKey {
  return ALL_SECTIONS.some((section) => section.key === key);
}

export interface SectionStats {
  /** Number of items in the section; undefined where a count isn't meaningful. */
  count?: number;
  /** Number of unpublished draft changes affecting the section. */
  changes: number;
}

/** Per-section item counts and draft-change counts for the navigator. */
export function computeSectionStats(
  model: SemanticModel,
  changes: DraftChanges,
): Record<SemanticModelSectionKey, SectionStats> {
  const dimensions = model.entities.flatMap((e) => e.dimensions);
  const measures = model.entities.flatMap((e) => e.measures);
  // Relationships and synonyms are fields on dimensions/measures, so only
  // edits to that specific field count as a change to those sections.
  const fieldChanged = (list: DraftChanges['dimensions'], label: string) =>
    list.filter((c) => c.kind === 'modified' && c.fields.some((f) => f.label === label)).length;

  return {
    entities: { count: model.entities.length, changes: changes.entities.length },
    dimensions: { count: dimensions.length, changes: changes.dimensions.length },
    measures: { count: measures.length, changes: changes.measures.length },
    relationships: {
      count: dimensions.filter((d) => d.reference).length,
      changes: fieldChanged(changes.dimensions, 'Relationship'),
    },
    synonyms: {
      count: [...dimensions, ...measures].reduce((sum, f) => sum + (f.synonyms?.length ?? 0), 0),
      changes: fieldChanged(changes.dimensions, 'Synonyms') + fieldChanged(changes.measures, 'Synonyms'),
    },
    metrics: { count: (model.metrics ?? []).length, changes: changes.metrics.length },
    kpis: { count: (model.kpis ?? []).length, changes: changes.kpis.length },
    json: { changes: 0 },
  };
}
