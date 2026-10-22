import { useMemo, useState } from 'react';
import type { KPI, Metric, SemanticModel } from '@/types/api';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { Modal } from '@/components/common/Modal';
import { buildSemanticFieldGroups } from '@/utils/semanticFields';
import { KpiEditor } from '../kpis/KpiEditor';
import { KpiList } from '../kpis/KpiList';

interface KpisStepProps {
  model: SemanticModel;
  onChange: (kpis: KPI[]) => void;
  /** A metric created inline from the KPI editor's metric picker. */
  onCreateMetric: (metric: Metric) => void;
}

/** The wizard's KPIs step - edits the in-progress model's KPIs in memory
 * (nothing is saved until the wizard's Save as draft / Publish). */
export function KpisStep({ model, onChange, onCreateMetric }: KpisStepProps) {
  const kpis = model.kpis ?? [];
  const fieldGroups = useMemo(() => buildSemanticFieldGroups(model), [model]);
  const metricsById = useMemo(() => new Map((model.metrics ?? []).map((m) => [m.id, m])), [model]);
  const localMetrics = useMemo(() => ({ model, onCreateMetric }), [model, onCreateMetric]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<KPI | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openEditor = (kpi: KPI | null) => {
    setEditing(kpi);
    setError(null);
    setModalOpen(true);
  };

  const handleSubmit = (kpi: KPI) => {
    if (!editing && kpis.some((k) => k.id === kpi.id)) {
      setError(`A KPI with id "${kpi.id}" already exists.`);
      return;
    }
    onChange(editing ? kpis.map((k) => (k.id === editing.id ? kpi : k)) : [...kpis, kpi]);
    setModalOpen(false);
  };

  const handleDelete = (kpi: KPI) => {
    if (!window.confirm(`Remove KPI "${kpi.name}"?`)) return;
    onChange(kpis.filter((k) => k.id !== kpi.id));
  };

  const handleToggle = (kpi: KPI, enabled: boolean) =>
    onChange(kpis.map((k) => (k.id === kpi.id ? { ...k, enabled } : k)));

  return (
    <div className="form-grid">
      <div className="semantic-tab-toolbar">
        <Button onClick={() => openEditor(null)}>Add KPI</Button>
      </div>

      {kpis.length === 0 ? (
        <EmptyState
          title="No KPIs yet"
          description="Optional - add KPIs now, or later from the Semantic Model page."
        />
      ) : (
        <KpiList
          kpis={kpis}
          metricsById={metricsById}
          onEdit={openEditor}
          onDelete={handleDelete}
          onToggleEnabled={handleToggle}
          togglingId={null}
          deletingId={null}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add KPI'}
        width={700}
      >
        {error && <div className="test-result test-result-error">{error}</div>}
        <KpiEditor
          key={editing?.id ?? 'new'}
          initial={editing}
          fieldGroups={fieldGroups}
          localMetrics={localMetrics}
          onSubmit={handleSubmit}
          onCancel={() => setModalOpen(false)}
        />
      </Modal>
    </div>
  );
}
