import type { TableData } from '@/types/api';
import { formatCellValue, titleCase } from '@/utils/format';

interface KpiCardsProps {
  table: TableData;
}

/**
 * Renders a table of rows as a grid of KPI stat cards -- each row becomes a
 * card, with the first non-numeric column (if any) used as the card title
 * and remaining columns shown as stat/label pairs.
 */
export function KpiCards({ table }: KpiCardsProps) {
  const { columns, rows } = table;
  if (rows.length === 0) {
    return <p className="chat-empty-note">No KPI values returned.</p>;
  }

  const labelColumn = columns.find((c) => rows.every((r) => typeof r[c] !== 'number'));
  const valueColumns = columns.filter((c) => c !== labelColumn);

  return (
    <div className="kpi-card-grid">
      {rows.map((row, idx) => (
        <div className="kpi-card" key={idx}>
          {labelColumn && <div className="kpi-card-title">{formatCellValue(row[labelColumn])}</div>}
          <div className="kpi-card-stats">
            {valueColumns.map((col) => (
              <div className="kpi-card-stat" key={col}>
                <span className="kpi-card-stat-value">{formatCellValue(row[col])}</span>
                <span className="kpi-card-stat-label">{titleCase(col)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
