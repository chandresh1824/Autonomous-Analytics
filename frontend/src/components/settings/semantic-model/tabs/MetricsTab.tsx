import { useMemo, useState } from 'react';
import type { Metric, SemanticModel } from '@/types/api';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { Modal } from '@/components/common/Modal';
import { useToast } from '@/components/common/Toast';
import { useCreateMetric, useDeleteMetric, useUpdateMetric } from '@/features/metric/hooks';
import { getApiErrorMessage } from '@/services/apiClient';
import { buildSemanticFieldGroups } from '@/utils/semanticFields';
import { MetricEditor } from '../metrics/MetricEditor';
import { MetricList } from '../metrics/MetricList';

/** Metrics live in the semantic model alongside entities and KPIs; every
 * change here is saved to the database's draft until published. */
export function MetricsTab({ model, connectionId }: { model: SemanticModel; connectionId?: string }) {
  const toast = useToast();
  const createMetric = useCreateMetric(connectionId);
  const updateMetric = useUpdateMetric(connectionId);
  const deleteMetric = useDeleteMetric(connectionId);
  const fieldGroups = useMemo(() => buildSemanticFieldGroups(model), [model]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Metric | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const metrics = model.metrics ?? [];

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (metric: Metric) => {
    setEditing(metric);
    setModalOpen(true);
  };

  const handleSubmit = (metric: Metric) => {
    const options = {
      onSuccess: () => {
        toast.success(`Metric ${editing ? 'updated' : 'created'} (draft). Publish to make it live.`);
        setModalOpen(false);
      },
      onError: (err: unknown) =>
        toast.error(getApiErrorMessage(err, `Failed to ${editing ? 'update' : 'create'} metric.`)),
    };
    if (editing) updateMetric.mutate({ id: editing.id, payload: metric }, options);
    else createMetric.mutate(metric, options);
  };

  const handleDelete = (metric: Metric) => {
    if (!window.confirm(`Delete metric "${metric.name}"?`)) return;
    setDeletingId(metric.id);
    deleteMetric.mutate(metric.id, {
      onSuccess: () => toast.success('Metric deleted (draft). Publish to apply.'),
      onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to delete metric.')),
      onSettled: () => setDeletingId(null),
    });
  };

  return (
    <div>
      <div className="semantic-tab-toolbar">
        <Button onClick={openCreate}>Add metric</Button>
      </div>

      {metrics.length === 0 ? (
        <EmptyState title="No metrics defined" description="Add a metric so KPIs can reference it." />
      ) : (
        <MetricList
          metrics={metrics}
          kpis={model.kpis ?? []}
          onEdit={openEdit}
          onDelete={handleDelete}
          deletingId={deletingId}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add metric'}
        width={700}
      >
        <MetricEditor
          key={editing?.id ?? 'new'}
          initial={editing}
          model={model}
          fieldGroups={fieldGroups}
          onSubmit={handleSubmit}
          onCancel={() => setModalOpen(false)}
          submitting={createMetric.isPending || updateMetric.isPending}
        />
      </Modal>
    </div>
  );
}
