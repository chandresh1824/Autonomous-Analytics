import { useState } from 'react';
import type { Metric } from '@/types/api';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { useMetrics } from '@/features/metric/hooks';
import { MetricQuickCreate, type LocalMetricSource } from './MetricQuickCreate';

interface MetricPickerProps {
  value: string[];
  onChange: (value: string[]) => void;
  connectionId?: string;
  /** Pick from (and create into) an unsaved in-memory model instead. */
  local?: LocalMetricSource;
}

/** Lets a KPI reference existing Metrics by checkbox instead of typing raw
 * (unvalidated) metric ids, and offers creating a brand-new Metric - from an
 * existing Measure - inline, without leaving the KPI form. */
export function MetricPicker({ value, onChange, connectionId, local }: MetricPickerProps) {
  const metricsQuery = useMetrics(connectionId, !local);
  const [creating, setCreating] = useState(false);

  const metrics = local ? (local.model.metrics ?? []) : (metricsQuery.data ?? []);

  const toggle = (metricId: string, checked: boolean) => {
    if (checked) {
      if (!value.includes(metricId)) onChange([...value, metricId]);
    } else {
      onChange(value.filter((id) => id !== metricId));
    }
  };

  const handleCreated = (metric: Metric) => {
    setCreating(false);
    if (!value.includes(metric.id)) onChange([...value, metric.id]);
  };

  return (
    <div className="metric-picker">
      {!local && metricsQuery.isLoading ? (
        <div className="settings-loading">
          <Spinner size={16} />
        </div>
      ) : metrics.length === 0 && !creating ? (
        <p className="settings-table-muted">No metrics defined yet.</p>
      ) : (
        <div className="metric-picker-list">
          {metrics.map((metric) => (
            <label key={metric.id} className="metric-picker-item">
              <input
                type="checkbox"
                checked={value.includes(metric.id)}
                onChange={(e) => toggle(metric.id, e.target.checked)}
              />
              <span className="metric-picker-item-body">
                <span className="settings-table-primary">{metric.name}</span>
                <span className="settings-table-muted">
                  {metric.id} · base measure: {metric.base_measure}
                  {metric.description ? ` — ${metric.description}` : ''}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      {creating ? (
        <MetricQuickCreate
          connectionId={connectionId}
          local={local}
          onCreated={handleCreated}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(true)}>
          + New metric
        </Button>
      )}
    </div>
  );
}
