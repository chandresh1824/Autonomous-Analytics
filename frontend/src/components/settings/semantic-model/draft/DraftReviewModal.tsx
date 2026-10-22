import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { ChangeSection } from './ChangeSection';
import { CHANGE_SECTIONS, type DraftChanges, type ModelChange } from './draftChanges';

interface DraftReviewModalProps {
  open: boolean;
  onClose: () => void;
  changes: DraftChanges;
  loading: boolean;
  hasPublished: boolean;
  blockers: string[];
  onPublish: () => void;
  onDiscardAll: () => void;
  onRevert: (change: ModelChange) => void;
  revertingKey: string | null;
  publishing: boolean;
  reverting: boolean;
}

/** Lists every draft change (entities through KPIs) against the published
 * model, so nothing goes live without being seen first. */
export function DraftReviewModal({
  open,
  onClose,
  changes,
  loading,
  hasPublished,
  blockers,
  onPublish,
  onDiscardAll,
  onRevert,
  revertingKey,
  publishing,
  reverting,
}: DraftReviewModalProps) {
  const busy = publishing || reverting;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Review changes before publishing"
      width={760}
      dismissable={!busy}
      footer={
        <>
          <Button
            variant="danger"
            className="draft-review-discard draft-action-discard"
            onClick={onDiscardAll}
            disabled={busy}
          >
            Discard all
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            className="draft-action-publish"
            onClick={onPublish}
            loading={publishing}
            disabled={blockers.length > 0 || reverting}
          >
            Publish
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="settings-loading">
          <Spinner size={20} />
        </div>
      ) : (
        <div className="draft-review">
          {hasPublished ? (
            <div className="draft-review-replace-warning" role="alert">
              <strong>The existing semantic model will be replaced.</strong> Publishing makes this draft the live
              model for this database only - anything not in the draft is no longer used. Other databases are not
              affected.
            </div>
          ) : (
            <p className="settings-table-muted">
              Nothing has been published for this database yet - everything below will go live.
            </p>
          )}

          {blockers.length > 0 && (
            <div className="test-result test-result-error">
              <strong>Can&rsquo;t publish yet.</strong> {blockers.join(' ')}
            </div>
          )}

          {CHANGE_SECTIONS.map((section) => (
            <ChangeSection
              key={section.key}
              title={section.title}
              changes={changes[section.key]}
              onRevert={onRevert}
              revertingKey={revertingKey}
              disabled={publishing}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
