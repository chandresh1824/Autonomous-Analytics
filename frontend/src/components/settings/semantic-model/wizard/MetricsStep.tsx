import { useMemo, useState } from 'react';
import type { Metric, SemanticModel } from '@/types/api';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { Modal } from '@/components/common/Modal';
import { buildSemanticFieldGroups } from '@/utils/semanticFields';
import { MetricEditor } from '../metrics/MetricEditor';
import { MetricList } from '../metrics/MetricList';

interface MetricsStepProps {
  model: SemanticModel;
  onChange: (metrics: Metric[]) => void;
}

/** The wizard's Metrics step - edits the in-progress model's metrics in
 * memory (nothing is saved until the wizard's Save as draft / Publish). */
export function MetricsStep({ model, onChange }: MetricsStepProps) {
  const metrics = model.metrics ?? [];
  const fieldGroups = useMemo(() => buildSemanticFieldGroups(model), [model]);
  const hasMeasures = model.entities.some((e) => e.measures.length > 0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Metric | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openEditor = (metric: Metric | null) => {
    setEditing(metric);
    setError(null);
    setModalOpen(true);
  };

  const handleSubmit = (metric: Metric) => {
    if (!editing && metrics.some((m) => m.id === metric.id)) {
      setError(`A metric with id "${metric.id}" already exists.`);
      return;
    }
    onChange(editing ? metrics.map((m) => (m.id === editing.id ? metric : m)) : [...metrics, metric]);
    setModalOpen(false);
  };

  const handleDelete = (metric: Metric) => {
    if (!window.confirm(`Remove metric "${metric.name}"?`)) return;
    onChange(metrics.filter((m) => m.id !== metric.id));
  };

  return (
    <div className="form-grid">
      <div className="semantic-tab-toolbar">
        <Button onClick={() => openEditor(null)} disabled={!hasMeasures} title={hasMeasures ? undefined : 'Add measures first.'}>
          Add metric
        </Button>
      </div>

      {metrics.length === 0 ? (
        <EmptyState
          title="No metrics yet"
          description={
            hasMeasures
              ? 'Optional - add metrics now, or later from the Semantic Model page.'
              : 'Metrics are built on measures. Go back to Measures to add some first.'
          }
        />
      ) : (
        <MetricList metrics={metrics} kpis={model.kpis ?? []} onEdit={openEditor} onDelete={handleDelete} deletingId={null} />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add metric'}
        width={700}
      >
        {error && <div className="test-result test-result-error">{error}</div>}
        <MetricEditor
          key={editing?.id ?? 'new'}
          initial={editing}
          model={model}
          fieldGroups={fieldGroups}
          onSubmit={handleSubmit}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>
    </div>
  );
}
