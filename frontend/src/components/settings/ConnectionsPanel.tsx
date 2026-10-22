import { useEffect, useState } from 'react';
import { ConnectionForm } from './ConnectionForm';
import { ConnectionList, ConnectionListLoading } from './ConnectionList';
import {
  useConnections,
  useCreateConnection,
  useDeleteConnection,
  useSetDefaultConnection,
  useTestConnection,
  useTestConnectionDraft,
  useUpdateConnection,
} from '@/features/connections/hooks';
import type {
  ConnectionCreate,
  ConnectionOut,
  ConnectionTestPayload,
  ConnectionTestResult,
  ConnectionUpdate,
} from '@/types/api';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { EmptyState } from '@/components/common/EmptyState';
import { useToast } from '@/components/common/Toast';
import { getApiErrorMessage } from '@/services/apiClient';

interface ConnectionsPanelProps {
  /** Rendered inside a dialog that supplies its own title - show a compact
   * toolbar instead of the page heading. */
  embedded?: boolean;
  /** Told when the add/edit connection form opens or closes, so a host
   * dialog can avoid closing underneath it. */
  onEditorOpenChange?: (open: boolean) => void;
}

export function ConnectionsPanel({ embedded = false, onEditorOpenChange }: ConnectionsPanelProps = {}) {
  const toast = useToast();
  const connectionsQuery = useConnections();
  const createConnection = useCreateConnection();
  const updateConnection = useUpdateConnection();
  const deleteConnection = useDeleteConnection();
  const setDefaultConnection = useSetDefaultConnection();
  const testDraft = useTestConnectionDraft();
  const testSaved = useTestConnection();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionOut | null>(null);
  const [testingSavedId, setTestingSavedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Held here rather than read from testDraft.data so the mutation (whose
  // variables include the typed password) can be reset as soon as it settles.
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const openCreate = () => {
    setEditing(null);
    setTestResult(null);
    setModalOpen(true);
  };

  const openEdit = (conn: ConnectionOut) => {
    setEditing(conn);
    setTestResult(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setTestResult(null);
  };

  const handleSubmit = (payload: ConnectionCreate | ConnectionUpdate) => {
    if (editing) {
      updateConnection.mutate(
        { id: editing.id, payload: payload as ConnectionUpdate },
        {
          onSuccess: () => {
            toast.success('Connection updated.');
            closeModal();
          },
          onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to update connection.')),
          onSettled: () => updateConnection.reset(),
        },
      );
    } else {
      createConnection.mutate(payload as ConnectionCreate, {
        onSuccess: () => {
          toast.success('Connection created.');
          closeModal();
        },
        onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to create connection.')),
        onSettled: () => createConnection.reset(),
      });
    }
  };

  const handleTestDraft = (payload: ConnectionTestPayload) => {
    setTestResult(null);
    testDraft.mutate(
      { ...payload, connection_id: editing?.id ?? null },
      {
        onSuccess: (result) => setTestResult(result),
        onError: (err) => toast.error(getApiErrorMessage(err, 'Connection test failed.')),
        onSettled: () => testDraft.reset(),
      },
    );
  };

  const handleDelete = (conn: ConnectionOut) => {
    if (!window.confirm(`Delete connection "${conn.name}"? This cannot be undone.`)) return;
    setDeletingId(conn.id);
    deleteConnection.mutate(conn.id, {
      onSuccess: () => toast.success('Connection deleted.'),
      onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to delete connection.')),
      onSettled: () => setDeletingId(null),
    });
  };

  const handleSetDefault = (conn: ConnectionOut) => {
    setDefaultConnection.mutate(conn.id, {
      onSuccess: () => toast.success(`"${conn.name}" is now the default connection.`),
      onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to set default connection.')),
    });
  };

  const handleTestSaved = (conn: ConnectionOut) => {
    setTestingSavedId(conn.id);
    testSaved.mutate(conn.id, {
      onSuccess: (result) => (result.success ? toast.success(result.message) : toast.error(result.message)),
      onError: (err) => toast.error(getApiErrorMessage(err, 'Connection test failed.')),
      onSettled: () => setTestingSavedId(null),
    });
  };

  useEffect(() => {
    onEditorOpenChange?.(modalOpen);
  }, [modalOpen, onEditorOpenChange]);

  const connections = connectionsQuery.data ?? [];

  return (
    <div className={embedded ? 'connections-embedded' : 'settings-panel'}>
      {embedded ? (
        <div className="semantic-tab-toolbar connections-embedded-toolbar">
          <p className="settings-panel-subtitle">
            The database connections available to the analytics agent. Each has its own semantic model.
          </p>
          {/* Icon-only "add" action: a database with a plus badge. */}
          <button
            type="button"
            className="conn-add-btn"
            onClick={openCreate}
            aria-label="Add connection"
            title="Add connection"
          >
            <Icon name="database" size={20} strokeWidth={1.9} />
            <span className="conn-add-badge" aria-hidden="true">
              <Icon name="plus" size={11} strokeWidth={3} />
            </span>
          </button>
        </div>
      ) : (
        <div className="settings-panel-header">
          <div>
            <h2>Data connections</h2>
            <p className="settings-panel-subtitle">
              Manage the database connections available to the analytics agent.
            </p>
          </div>
          <Button onClick={openCreate}>Add connection</Button>
        </div>
      )}

      {connectionsQuery.isLoading ? (
        <ConnectionListLoading />
      ) : connections.length === 0 ? (
        <EmptyState
          title="No connections yet"
          description="Add a connection so the agent can query your data."
          action={<Button onClick={openCreate}>Add connection</Button>}
        />
      ) : (
        <ConnectionList
          connections={connections}
          onEdit={openEdit}
          onDelete={handleDelete}
          onSetDefault={handleSetDefault}
          onTest={handleTestSaved}
          testingId={testingSavedId}
          deletingId={deletingId}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? `Edit ${editing.name}` : 'Add connection'}
        width={620}
      >
        <ConnectionForm
          initial={editing}
          onSubmit={handleSubmit}
          onTest={handleTestDraft}
          testing={testDraft.isPending}
          submitting={createConnection.isPending || updateConnection.isPending}
          testResult={testResult}
          onCancel={closeModal}
        />
      </Modal>
    </div>
  );
}
