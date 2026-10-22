import { useMemo, useState } from 'react';
import type { KPI, SemanticModel } from '@/types/api';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { Modal } from '@/components/common/Modal';
import { useToast } from '@/components/common/Toast';
import { useCreateKpi, useDeleteKpi, useDisableKpi, useEnableKpi, useUpdateKpi } from '@/features/kpi/hooks';
import { getApiErrorMessage } from '@/services/apiClient';
import { buildSemanticFieldGroups } from '@/utils/semanticFields';
import { KpiEditor } from '../kpis/KpiEditor';
import { KpiList } from '../kpis/KpiList';

/** KPIs live in the semantic model alongside entities and metrics; every
 * change here is saved to the database's draft until published. */
export function KpisTab({ model, connectionId }: { model: SemanticModel; connectionId?: string }) {
  const toast = useToast();
  const createKpi = useCreateKpi(connectionId);
  const updateKpi = useUpdateKpi(connectionId);
  const deleteKpi = useDeleteKpi(connectionId);
  const enableKpi = useEnableKpi(connectionId);
  const disableKpi = useDisableKpi(connectionId);
  // Filters can only reference this database's own fields.
  const fieldGroups = useMemo(() => buildSemanticFieldGroups(model), [model]);
  const metricsById = useMemo(() => new Map((model.metrics ?? []).map((m) => [m.id, m])), [model]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<KPI | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const kpis = model.kpis ?? [];

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (kpi: KPI) => {
    setEditing(kpi);
    setModalOpen(true);
  };

  const handleSubmit = (kpi: KPI) => {
    const options = {
      onSuccess: () => {
        toast.success(`KPI ${editing ? 'updated' : 'created'} (draft). Publish to make it live.`);
        setModalOpen(false);
      },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, `Failed to ${editing ? 'update' : 'create'} KPI.`)),
    };
    if (editing) updateKpi.mutate({ id: editing.id, payload: kpi }, options);
    else createKpi.mutate(kpi, options);
  };

  const handleDelete = (kpi: KPI) => {
    if (!window.confirm(`Delete KPI "${kpi.name}"?`)) return;
    setDeletingId(kpi.id);
    deleteKpi.mutate(kpi.id, {
      onSuccess: () => toast.success('KPI deleted (draft). Publish to apply.'),
      onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to delete KPI.')),
      onSettled: () => setDeletingId(null),
    });
  };

  const handleToggle = (kpi: KPI, enabled: boolean) => {
    setTogglingId(kpi.id);
    const mutation = enabled ? enableKpi : disableKpi;
    mutation.mutate(kpi.id, {
      onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to update KPI.')),
      onSettled: () => setTogglingId(null),
    });
  };

  return (
    <div>
      <div className="semantic-tab-toolbar">
        <Button onClick={openCreate}>Add KPI</Button>
      </div>

      {kpis.length === 0 ? (
        <EmptyState
          title="No KPIs defined"
          description="Add a KPI so the agent can compute and reference it in answers."
        />
      ) : (
        <KpiList
          kpis={kpis}
          metricsById={metricsById}
          onEdit={openEdit}
          onDelete={handleDelete}
          onToggleEnabled={handleToggle}
          togglingId={togglingId}
          deletingId={deletingId}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add KPI'}
        width={700}
      >
        <KpiEditor
          key={editing?.id ?? 'new'}
          initial={editing}
          fieldGroups={fieldGroups}
          connectionId={connectionId}
          onSubmit={handleSubmit}
          onCancel={() => setModalOpen(false)}
          submitting={createKpi.isPending || updateKpi.isPending}
        />
      </Modal>
    </div>
  );
}
