import type { IconName } from '@/components/common/Icon';

export type WizardStep =
  | 'tables'
  | 'relationships'
  | 'dimensions'
  | 'measures'
  | 'synonyms'
  | 'metrics'
  | 'kpis'
  | 'preview';

/** Colour family for a step - shares the Semantic Model page's group colours,
 * plus a green "publish" tone for the final step. */
export type WizardTone = 'model' | 'logic' | 'publish';

export interface WizardStepDef {
  key: WizardStep;
  label: string;
  title: string;
  description: string;
  icon: IconName;
  tone: WizardTone;
  /** Steps that can be skipped without adding anything. */
  optional?: boolean;
}

export interface WizardStepGroup {
  label: string;
  tone: WizardTone;
  steps: WizardStepDef[];
}

export const WIZARD_GROUPS: WizardStepGroup[] = [
  {
    label: 'Data model',
    tone: 'model',
    steps: [
      {
        key: 'tables',
        label: 'Tables',
        title: 'Choose database and tables',
        description: 'Pick the database and the tables the agent should be able to query.',
        icon: 'table',
        tone: 'model',
      },
      {
        key: 'relationships',
        label: 'Relationships',
        title: 'Connect the tables',
        description: 'Accept suggested joins between the selected tables, or add your own.',
        icon: 'link',
        tone: 'model',
        optional: true,
      },
      {
        key: 'dimensions',
        label: 'Dimensions',
        title: 'Model dimensions',
        description: 'Columns used to group, filter, and describe data.',
        icon: 'tag',
        tone: 'model',
      },
      {
        key: 'measures',
        label: 'Measures',
        title: 'Model measures',
        description: 'Aggregations such as sums, counts, and averages.',
        icon: 'sigma',
        tone: 'model',
      },
      {
        key: 'synonyms',
        label: 'Synonyms',
        title: 'Add synonyms',
        description: 'Alternative names users may use for dimensions and measures.',
        icon: 'text',
        tone: 'model',
        optional: true,
      },
    ],
  },
  {
    label: 'Business logic',
    tone: 'logic',
    steps: [
      {
        key: 'metrics',
        label: 'Metrics',
        title: 'Define metrics',
        description: 'Reusable measures with optional default filters. KPIs are built from these.',
        icon: 'chart',
        tone: 'logic',
        optional: true,
      },
      {
        key: 'kpis',
        label: 'KPIs',
        title: 'Define KPIs',
        description: 'Business KPIs built from metrics, which the agent can reference in answers.',
        icon: 'target',
        tone: 'logic',
        optional: true,
      },
    ],
  },
  {
    label: 'Review',
    tone: 'publish',
    steps: [
      {
        key: 'preview',
        label: 'Publish',
        title: 'Review and publish',
        description: 'Check the full model, then publish it so the agent can use it.',
        icon: 'check',
        tone: 'publish',
      },
    ],
  },
];

export const WIZARD_STEPS: WizardStepDef[] = WIZARD_GROUPS.flatMap((group) => group.steps);
