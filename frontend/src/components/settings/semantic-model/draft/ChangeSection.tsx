import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import type { ChangeKind, ModelChange } from './draftChanges';

const KIND_TONE: Record<ChangeKind, 'success' | 'warning' | 'danger'> = {
  added: 'success',
  modified: 'warning',
  removed: 'danger',
};
const KIND_LABEL: Record<ChangeKind, string> = { added: 'Added', modified: 'Modified', removed: 'Removed' };
const REVERT_LABEL: Record<ChangeKind, string> = { added: 'Remove', modified: 'Revert', removed: 'Restore' };

interface ChangeSectionProps {
  title: string;
  changes: ModelChange[];
  onRevert: (change: ModelChange) => void;
  /** The change currently being reverted, if any - other rows' actions wait for it. */
  revertingKey: string | null;
  disabled?: boolean;
}

/** One group of draft changes in the review (e.g. "Dimensions"), each with
 * its draft values and its own revert action. Only what the draft contains is
 * listed - items that exist only in the published model, and published
 * values, are not shown. */
export function ChangeSection({ title, changes: allChanges, onRevert, revertingKey, disabled }: ChangeSectionProps) {
  const changes = allChanges.filter((change) => change.kind !== 'removed');
  if (!changes.length) return null;
  return (
    <section className="draft-review-section">
      <h4>
        {title} <span className="settings-table-muted">({changes.length})</span>
      </h4>
      <ul className="draft-review-list">
        {changes.map((change) => (
          <li key={change.key} className="draft-review-item">
            <div className="draft-review-item-head">
              <Badge tone={KIND_TONE[change.kind]}>{KIND_LABEL[change.kind]}</Badge>
              <span className="settings-table-primary">{change.name}</span>
              {change.detail && <span className="settings-table-muted mono-cell">{change.detail}</span>}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="draft-review-revert"
                title="Discard this draft change and go back to the published version"
                loading={revertingKey === change.key}
                disabled={disabled || (revertingKey !== null && revertingKey !== change.key)}
                onClick={() => onRevert(change)}
              >
                {REVERT_LABEL[change.kind]}
              </Button>
            </div>
            {change.fields.length > 0 && (
              <table className="draft-review-fields">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Draft</th>
                  </tr>
                </thead>
                <tbody>
                  {change.fields.map((field) => (
                    <tr key={field.label}>
                      <td>{field.label}</td>
                      <td className="draft-review-after">{field.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
