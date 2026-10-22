import type { KPI, Metric } from '@/types/api';
import { IconButton } from '@/components/common/IconButton';
import { Toggle } from '@/components/common/Toggle';

interface KpiListProps {
  kpis: KPI[];
  metricsById: Map<string, Metric>;
  onEdit: (kpi: KPI) => void;
  onDelete: (kpi: KPI) => void;
  onToggleEnabled: (kpi: KPI, enabled: boolean) => void;
  togglingId: string | null;
  deletingId: string | null;
}

export function KpiList({
  kpis,
  metricsById,
  onEdit,
  onDelete,
  onToggleEnabled,
  togglingId,
  deletingId,
}: KpiListProps) {
  return (
    <div className="settings-table-wrap">
      <table className="settings-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Metrics</th>
            <th>Enabled</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {kpis.map((kpi) => (
            <tr key={kpi.id}>
              <td>
                <div className="settings-table-primary">{kpi.name}</div>
                <div className="settings-table-muted">{kpi.id}</div>
              </td>
              <td className="settings-table-muted">{kpi.description}</td>
              <td>
                {kpi.metric_ids.length === 0 ? (
                  <span className="settings-table-muted">–</span>
                ) : (
                  <div className="settings-table-badges">
                    {kpi.metric_ids.map((metricId) => (
                      <span key={metricId} className="tag-chip tag-chip-static" title={metricId}>
                        {metricsById.get(metricId)?.name ?? metricId}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td>
                <Toggle
                  checked={kpi.enabled}
                  disabled={togglingId === kpi.id}
                  onChange={(checked) => onToggleEnabled(kpi, checked)}
                />
              </td>
              <td>
                <div className="settings-table-actions">
                  <IconButton
                    icon="edit"
                    label={`Edit ${kpi.name}`}
                    variant="ghost"
                    size="xs"
                    round={false}
                    onClick={() => onEdit(kpi)}
                  />
                  <IconButton
                    icon="trash"
                    label={`Delete ${kpi.name}`}
                    variant="ghost"
                    size="xs"
                    round={false}
                    tone="danger"
                    loading={deletingId === kpi.id}
                    onClick={() => onDelete(kpi)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
