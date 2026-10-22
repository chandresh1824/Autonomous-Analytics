import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSemanticModel, useSemanticModelVersions } from '@/features/semantic-model/hooks';
import { useConnections } from '@/features/connections/hooks';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Spinner } from '@/components/common/Spinner';
import { EmptyState } from '@/components/common/EmptyState';
import { ConnectionsDialog } from './ConnectionsDialog';
import { DatabaseSelect } from './DatabaseSelect';
import { DraftStatusBanner } from './DraftStatusBanner';
import { DraftActions } from './draft/DraftActions';
import { SemanticModelWorkspace } from './SemanticModelWorkspace';
import { isSemanticModelSection } from './sections';
import { isWizardDraft } from '@/features/semantic-model/wizardDraft';

/** Router navigation state passed to the Semantic Model settings page (from
 * the "Add semantic model" page, or the old KPI page's redirect), so the
 * chosen connection and tab carry over without appearing in the URL. */
export interface SemanticModelNavState {
  connectionId?: string;
  tab?: string;
  /** Open the connections dialog on arrival (the old Connections page link). */
  openConnections?: boolean;
}

export function SemanticModelPanel() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as SemanticModelNavState | null;
  const connectionsQuery = useConnections();
  const connections = connectionsQuery.data ?? [];
  const [connectionsOpen, setConnectionsOpen] = useState(!!navState?.openConnections);
  const closeConnections = () => {
    setConnectionsOpen(false);
    // Drop the "open on arrival" flag so a page refresh doesn't reopen it.
    if (navState?.openConnections) {
      navigate(location.pathname, { replace: true, state: { ...navState, openConnections: false } });
    }
  };

  // Each connection has its own semantic model; the picker chooses which one
  // is shown and edited. It starts on the connection passed in navigation
  // state, else the default connection.
  const [activeConnectionId, setActiveConnectionId] = useState('');
  useEffect(() => {
    if (!connections.length) return;
    // Re-pick if the selected connection was deleted out from under us.
    if (activeConnectionId && connections.some((c) => c.id === activeConnectionId)) return;
    const preferred =
      connections.find((c) => c.id === navState?.connectionId) ??
      connections.find((c) => c.is_default) ??
      connections[0];
    setActiveConnectionId(preferred.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId, connections]);

  // The working copy (the pending draft if there is one, else the published
  // model) - edits must build on it, otherwise a second unpublished edit
  // would start from the published model and silently drop the first.
  const connectionId = activeConnectionId || undefined;
  const modelQuery = useSemanticModel(connectionId);
  const versionsQuery = useSemanticModelVersions(connectionId);

  // One draft per database: adding is offered only while nothing is
  // unpublished - except to continue the draft the wizard itself saved.
  const continuesWizard = isWizardDraft(activeConnectionId, versionsQuery.data);
  const hasPendingDraft = !continuesWizard && !!versionsQuery.data?.some((v) => v.status === 'draft');

  const goToCreate = () =>
    navigate('/settings/semantic-model/generate', {
      state: activeConnectionId ? ({ connectionId: activeConnectionId } satisfies SemanticModelNavState) : undefined,
    });

  return (
    <div className="settings-panel">
      {/* Everything about this database's model lives in one card: which
          database, its draft status, and the model itself. */}
      <div className="sm-card">
        <div className="sm-card-top">
          <div className="sm-card-top-row">
            <DatabaseSelect connections={connections} value={activeConnectionId} onChange={setActiveConnectionId} />
            <div className="sm-card-top-actions">
              <DraftActions connectionId={connectionId} />
              <Button
                variant="secondary"
                className="sm-add-model"
                onClick={goToCreate}
                disabled={!activeConnectionId || hasPendingDraft}
                title={
                  hasPendingDraft
                    ? 'This database has unpublished changes. Publish or discard them first.'
                    : modelQuery.data
                      ? 'Build a new semantic model as a draft. Publishing it replaces the current published model.'
                      : 'Build a semantic model from the database tables as a draft.'
                }
              >
                <span className="sm-add-model-icon" aria-hidden="true">
                  <Icon name="plus" size={14} strokeWidth={2.4} />
                </span>
                {continuesWizard ? 'Continue new semantic model' : 'Add new semantic model'}
              </Button>
              <Button variant="ghost" className="sm-connections-btn" onClick={() => setConnectionsOpen(true)}>
                <span className="sm-connections-icon" aria-hidden="true">
                  <Icon name="settings" size={14} strokeWidth={2} />
                </span>
                Connections
              </Button>
            </div>
          </div>
          <DraftStatusBanner model={modelQuery.data} versions={versionsQuery.data} />
        </div>

        {connectionsQuery.isLoading || modelQuery.isLoading ? (
          <div className="settings-loading">
            <Spinner size={20} />
          </div>
        ) : modelQuery.data ? (
          // Keyed by connection so every section's local editor state resets when
          // switching databases - an open edit for one connection can never be
          // saved into another connection's model.
          <>
            <p className="sm-edit-hint">
              Edit the current model below. All changes are saved as a draft until you publish.
            </p>
            <SemanticModelWorkspace
              key={activeConnectionId}
              model={modelQuery.data}
              connectionId={connectionId}
              initialSection={isSemanticModelSection(navState?.tab) ? navState.tab : undefined}
            />
          </>
        ) : (
          <div className="sm-card-empty">
            <EmptyState title="No semantic model for this database yet" />
          </div>
        )}
      </div>
      <ConnectionsDialog open={connectionsOpen} onClose={closeConnections} />
    </div>
  );
}
