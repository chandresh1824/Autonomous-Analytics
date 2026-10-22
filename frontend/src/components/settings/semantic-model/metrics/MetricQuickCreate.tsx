import { KeyboardEvent, useMemo, useState } from 'react';
import type { Metric, SemanticModel } from '@/types/api';
import { Button } from '@/components/common/Button';
import { useSemanticModel } from '@/features/semantic-model/hooks';
import { useCreateMetric } from '@/features/metric/hooks';
import { useToast } from '@/components/common/Toast';
import { getApiErrorMessage } from '@/services/apiClient';

/** Work on an unsaved, in-memory model instead of the saved one (the
 * semantic model wizard): measures come from `model`, and the new metric is
 * handed to `onCreateMetric` rather than saved through the API. */
export interface LocalMetricSource {
  model: SemanticModel;
  onCreateMetric: (metric: Metric) => void;
}

interface MetricQuickCreateProps {
  onCreated: (metric: Metric) => void;
  onCancel: () => void;
  connectionId?: string;
  local?: LocalMetricSource;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Inline form for creating a new Metric from an existing Measure, without
 * leaving the KPI editor - lets someone go straight from "there's no metric
 * for this yet" to a usable metric_id without switching screens. */
export function MetricQuickCreate({ onCreated, onCancel, connectionId, local }: MetricQuickCreateProps) {
  const modelQuery = useSemanticModel(connectionId, false, !local);
  const sourceModel = local?.model ?? modelQuery.data;
  const createMetric = useCreateMetric(connectionId);
  const toast = useToast();

  const measureOptions = useMemo(
    () =>
      (sourceModel?.entities ?? []).flatMap((entity) =>
        entity.measures.map((measure) => ({
          key: `${entity.name}::${measure.name}`,
          entityName: entity.name,
          measureName: measure.name,
          label: `${entity.name} · ${measure.name}`,
        })),
      ),
    [sourceModel],
  );

  const [selectedMeasureKey, setSelectedMeasureKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const selected = measureOptions.find((m) => m.key === selectedMeasureKey);
    if (!selected) {
      setError('Choose a measure to base this metric on.');
      return;
    }
    if (!name.trim()) {
      setError('Give the metric a name.');
      return;
    }
    setError(null);

    const metric: Metric = {
      id: `metric_${slugify(name)}`,
      name: name.trim(),
      description,
      base_measure: selected.measureName,
      filters: [],
      filter_logic: null,
      supported_dimensions: [],
      format: format.trim() || null,
    };

    if (local) {
      if ((local.model.metrics ?? []).some((m) => m.id === metric.id)) {
        setError(`A metric with id "${metric.id}" already exists.`);
        return;
      }
      local.onCreateMetric(metric);
      onCreated(metric);
      return;
    }

    createMetric.mutate(metric, {
      onSuccess: (created) => {
        toast.success(`Metric "${created.name}" created (draft). Publish to make it live.`);
        onCreated(created);
      },
      onError: (err) => setError(getApiErrorMessage(err, 'Failed to create metric.')),
    });
  };

  // Enter in one of these inputs would otherwise submit the enclosing KPI
  // form, so route it to this form's own submit instead.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Rendered as a <div>, not a <form>: this sits inside KpiEditor's <form>,
  // and nested forms are invalid HTML - the submit went to the KPI form
  // instead of creating the metric.
  return (
    <div className="form-grid metric-quick-create" onKeyDown={handleKeyDown}>
      <div className="form-field">
        <label htmlFor="metric-quick-measure">Based on measure</label>
        <select
          id="metric-quick-measure"
          value={selectedMeasureKey}
          onChange={(e) => setSelectedMeasureKey(e.target.value)}
          disabled={!local && modelQuery.isLoading}
        >
          <option value="">Select a measure…</option>
          {measureOptions.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="form-row-2">
        <div className="form-field">
          <label htmlFor="metric-quick-name">Metric name</label>
          <input id="metric-quick-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-field">
          <label htmlFor="metric-quick-format">Format</label>
          <input
            id="metric-quick-format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            placeholder="e.g. number, currency"
          />
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="metric-quick-description">Description</label>
        <textarea
          id="metric-quick-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>

      {error && <div className="test-result test-result-error">{error}</div>}

      <div className="form-actions">
        <div />
        <div className="form-actions-right">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" loading={createMetric.isPending} onClick={handleSubmit}>
            Create metric
          </Button>
        </div>
      </div>
    </div>
  );
}
