import { useMemo, useState } from 'react';
import type { SemanticModel } from '@/types/api';
import { Icon } from '@/components/common/Icon';
import { useSemanticModel } from '@/features/semantic-model/hooks';
import { computeDraftChanges } from './draft/draftChanges';
import { SectionNav } from './SectionNav';
import { ALL_SECTIONS, computeSectionStats, type SemanticModelSectionKey } from './sections';
import { DimensionsTab } from './tabs/DimensionsTab';
import { EntitiesTab } from './tabs/EntitiesTab';
import { JsonPreviewTab } from './tabs/JsonPreviewTab';
import { KpisTab } from './tabs/KpisTab';
import { MeasuresTab } from './tabs/MeasuresTab';
import { MetricsTab } from './tabs/MetricsTab';
import { RelationshipsTab } from './tabs/RelationshipsTab';
import { SynonymsTab } from './tabs/SynonymsTab';

interface SemanticModelWorkspaceProps {
  model: SemanticModel;
  /** Which datasource's draft every section's edits are saved into. */
  connectionId?: string;
  initialSection?: SemanticModelSectionKey;
}

/** The semantic model editor's navigator and active section. Rendered inside
 * the page's single semantic model card, so it adds no card of its own; the
 * section's group colour (data model / business logic / advanced) carries
 * through the header to tell the areas apart. */
export function SemanticModelWorkspace({
  model,
  connectionId,
  initialSection = 'entities',
}: SemanticModelWorkspaceProps) {
  const [active, setActive] = useState<SemanticModelSectionKey>(initialSection);
  // Same cached query DraftActions uses; drives the per-section change markers.
  const publishedQuery = useSemanticModel(connectionId, true);
  const stats = useMemo(
    () => computeSectionStats(model, computeDraftChanges(model, publishedQuery.data)),
    [model, publishedQuery.data],
  );
  const section = ALL_SECTIONS.find((s) => s.key === active) ?? ALL_SECTIONS[0];
  const { count, changes } = stats[section.key];

  return (
    <div className="sm-workspace" data-tone={section.tone}>
      <SectionNav active={active} onChange={setActive} stats={stats} />

      <section
        className="sm-section"
        id="sm-section-panel"
        role="tabpanel"
        aria-labelledby={`sm-tab-${section.key}`}
      >
        <header className="sm-section-header">
          <span className="sm-section-icon">
            <Icon name={section.icon} size={20} />
          </span>
          <div className="sm-section-heading">
            <h3>
              {section.label}
              {count !== undefined && <span className="sm-section-count">{count}</span>}
            </h3>
            <p>{section.description}</p>
          </div>
          {changes > 0 && (
            <span className="sm-section-changes">
              {changes} unpublished change{changes === 1 ? '' : 's'}
            </span>
          )}
        </header>

        <div className="sm-section-body">
          {active === 'entities' && <EntitiesTab model={model} connectionId={connectionId} />}
          {active === 'dimensions' && <DimensionsTab model={model} connectionId={connectionId} />}
          {active === 'measures' && <MeasuresTab model={model} connectionId={connectionId} />}
          {active === 'relationships' && <RelationshipsTab model={model} connectionId={connectionId} />}
          {active === 'synonyms' && <SynonymsTab model={model} connectionId={connectionId} />}
          {active === 'metrics' && <MetricsTab model={model} connectionId={connectionId} />}
          {active === 'kpis' && <KpisTab model={model} connectionId={connectionId} />}
          {active === 'json' && <JsonPreviewTab model={model} connectionId={connectionId} />}
        </div>
      </section>
    </div>
  );
}
