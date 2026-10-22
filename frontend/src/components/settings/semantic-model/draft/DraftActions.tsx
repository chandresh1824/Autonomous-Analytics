import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/Toast';
import {
  usePublishLatestVersion,
  useRevertSemanticDraft,
  useSemanticModel,
  useSemanticModelVersions,
} from '@/features/semantic-model/hooks';
import { getApiErrorMessage } from '@/services/apiClient';
import { getPublishBlockers } from '@/utils/semanticFields';
import { DraftReviewModal } from './DraftReviewModal';
import { computeDraftChanges, type ModelChange } from './draftChanges';

/**
 * The semantic model's draft actions - one pair for the whole model
 * (entities, dimensions, measures, relationships, synonyms, metrics, and
 * KPIs version together). Both buttons render only while the selected
 * database has draft changes: "Publish changes" opens a review before
 * anything goes live, and "Discard changes" drops the whole draft. Single
 * changes can be reverted from the review.
 */
export function DraftActions({ connectionId }: { connectionId?: string }) {
  const toast = useToast();
  const publish = usePublishLatestVersion();
  const revert = useRevertSemanticDraft(connectionId);
  const draftQuery = useSemanticModel(connectionId);
  // 404s when nothing has been published yet - treated as an empty model.
  const publishedQuery = useSemanticModel(connectionId, true);
  const versionsQuery = useSemanticModelVersions(connectionId);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [revertingKey, setRevertingKey] = useState<string | null>(null);

  const draft = draftQuery.data;
  const published = publishedQuery.data;
  const draftVersionId = versionsQuery.data?.find((v) => v.status === 'draft')?.id;
  const changes = useMemo(() => computeDraftChanges(draft, published), [draft, published]);
  const blockers = draft ? getPublishBlockers(draft) : [];
  const loading = draftQuery.isLoading || publishedQuery.isLoading || versionsQuery.isLoading;
  const hasChanges = !loading && !!draft && !!draftVersionId && changes.total > 0;
  const busy = publish.isPending || revert.isPending;

  // Close the review once the last change has been reverted.
  useEffect(() => {
    if (reviewOpen && !loading && !hasChanges && !busy) setReviewOpen(false);
  }, [reviewOpen, loading, hasChanges, busy]);

  const handlePublish = () => {
    if (blockers.length) return;
    publish.mutate(connectionId, {
      onSuccess: () => {
        toast.success('Changes published.');
        setReviewOpen(false);
      },
      onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to publish changes.')),
    });
  };

  const handleRevert = (change: ModelChange) => {
    if (!draft || !draftVersionId) return;
    setRevertingKey(change.key);
    const reverted = change.revert(draft);
    revert.mutate(
      // Nothing left to publish -> drop the draft rather than keep an empty one.
      { model: reverted, published, draftVersionId, removeDraft: computeDraftChanges(reverted, published).total === 0 },
      {
        onSuccess: () => toast.success(`Draft change to "${change.name}" discarded.`),
        onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to discard the change.')),
        onSettled: () => setRevertingKey(null),
      },
    );
  };

  const handleDiscardAll = () => {
    if (!draft || !draftVersionId) return;
    revert.mutate(
      { model: draft, published, draftVersionId, removeDraft: true },
      {
        onSuccess: () => {
          toast.success('Draft changes discarded.');
          setConfirmDiscardOpen(false);
        },
        onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to discard changes.')),
      },
    );
  };

  const discardMessage =
    `This discards all ${changes.total} draft change${changes.total === 1 ? '' : 's'} for this database ` +
    "(entities, dimensions, measures, metrics, and KPIs). This can't be undone." +
    (published ? '' : ' Nothing has been published yet, so this removes the draft model entirely.');

  if (!hasChanges && !reviewOpen && !confirmDiscardOpen) return null;

  return (
    <>
      {hasChanges && (
        <>
          <Button
            variant="danger"
            className="draft-action-discard"
            disabled={busy}
            onClick={() => setConfirmDiscardOpen(true)}
          >
            Discard changes
          </Button>
          <Button className="draft-action-publish" disabled={busy} onClick={() => setReviewOpen(true)}>
            Publish changes ({changes.total})
          </Button>
        </>
      )}

      <DraftReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        changes={changes}
        loading={loading}
        hasPublished={!!published}
        blockers={blockers}
        onPublish={handlePublish}
        onDiscardAll={() => setConfirmDiscardOpen(true)}
        onRevert={handleRevert}
        revertingKey={revertingKey}
        publishing={publish.isPending}
        reverting={revert.isPending}
      />

      <ConfirmDialog
        open={confirmDiscardOpen}
        title="Discard all draft changes?"
        message={discardMessage}
        confirmLabel="Discard changes"
        danger
        busy={revert.isPending}
        onConfirm={handleDiscardAll}
        onCancel={() => setConfirmDiscardOpen(false)}
      />
    </>
  );
}
