import { useMemo, useState } from 'react';
import { formatCellValue, titleCase } from '@/utils/format';
import { EmptyState } from '@/components/common/EmptyState';

interface DataTableProps {
  columns: string[];
  rows: Record<string, unknown>[];
  pageSize?: number;
}

export function DataTable({ columns, rows, pageSize = 10 }: DataTableProps) {
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const paged = useMemo(
    () => rows.slice(page * pageSize, page * pageSize + pageSize),
    [rows, page, pageSize],
  );

  if (rows.length === 0 || columns.length === 0) {
    return <EmptyState title="No rows returned" description="The query ran successfully but returned no data." />;
  }

  return (
    <div className="data-table-wrap">
      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{titleCase(col)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, idx) => (
              <tr key={idx}>
                {columns.map((col) => (
                  <td key={col}>{formatCellValue(row[col])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <div className="data-table-pagination">
          <button
            className="btn btn-ghost btn-sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </button>
          <span className="data-table-page-label">
            Page {page + 1} of {pageCount} &middot; {rows.length} rows
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
