import type { KPI, Metric } from '@/types/api';
import { IconButton } from '@/components/common/IconButton';

interface MetricListProps {
  metrics: Metric[];
  kpis: KPI[];
  onEdit: (metric: Metric) => void;
  onDelete: (metric: Metric) => void;
  deletingId: string | null;
}

export function MetricList({ metrics, kpis, onEdit, onDelete, deletingId }: MetricListProps) {
  return (
    <div className="settings-table-wrap">
      <table className="settings-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Base measure</th>
            <th>Filters</th>
            <th>Used by KPIs</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => {
            const usedBy = kpis.filter((kpi) => kpi.metric_ids.includes(metric.id));
            return (
              <tr key={metric.id}>
                <td>
                  <div className="settings-table-primary">{metric.name}</div>
                  <div className="settings-table-muted">{metric.id}</div>
                </td>
                <td className="mono-cell">{metric.base_measure}</td>
                <td className="settings-table-muted">{metric.filters.length || '–'}</td>
                <td>
                  {usedBy.length === 0 ? (
                    <span className="settings-table-muted">–</span>
                  ) : (
                    <div className="settings-table-badges">
                      {usedBy.map((kpi) => (
                        <span key={kpi.id} className="tag-chip tag-chip-static" title={kpi.id}>
                          {kpi.name}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  <div className="settings-table-actions">
                    <IconButton
                      icon="edit"
                      label={`Edit ${metric.name}`}
                      variant="ghost"
                      size="xs"
                      round={false}
                      onClick={() => onEdit(metric)}
                    />
                    {/* The backend refuses to delete a metric a KPI still uses. */}
                    <IconButton
                      icon="trash"
                      label={usedBy.length ? 'Used by KPIs - remove it from them first' : `Delete ${metric.name}`}
                      variant="ghost"
                      size="xs"
                      round={false}
                      tone="danger"
                      loading={deletingId === metric.id}
                      disabled={usedBy.length > 0}
                      onClick={() => onDelete(metric)}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
