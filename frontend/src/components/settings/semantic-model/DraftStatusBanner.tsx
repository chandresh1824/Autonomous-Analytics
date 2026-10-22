import type { SemanticModel, SemanticModelVersion } from '@/types/api';
import { getPublishBlockers } from '@/utils/semanticFields';

interface DraftStatusBannerProps {
  model?: SemanticModel;
  versions?: SemanticModelVersion[];
}

/** Tells the user whether what they're editing is live yet, and what (if
 * anything) is stopping it from being published. */
export function DraftStatusBanner({ model, versions }: DraftStatusBannerProps) {
  if (!model) return null;
  const blockers = getPublishBlockers(model);
  const hasDraft = versions?.[0]?.status === 'draft';
  const hasPublished = versions?.some((v) => v.status === 'published') ?? false;

  return (
    <>
      {blockers.length > 0 && (
        <div className="test-result test-result-error">
          <strong>Can&rsquo;t publish yet.</strong> {blockers.join(' ')}
        </div>
      )}
      {hasDraft && (
        <div className="test-result">
          <strong>Unpublished changes.</strong>{' '}
          {hasPublished
            ? 'Edits below are saved as a draft for this database. The agent keeps using the published model until you publish them.'
            : 'This model is a draft and has not been published yet, so the agent cannot use it until you publish it.'}
        </div>
      )}
    </>
  );
}
