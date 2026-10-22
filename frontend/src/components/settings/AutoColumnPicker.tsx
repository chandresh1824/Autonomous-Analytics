import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/common/Button';

/** Selected columns per table; a table is selected when it has a key here
 * (always with at least one column). */
export type ColumnSelection = Record<string, string[]>;

interface AutoColumnPickerProps {
  tables: string[];
  columnsOf: (table: string) => string[];
  value: ColumnSelection;
  onChange: (next: ColumnSelection) => void;
}

/**
 * Table + column picker for the wizard's "Auto Generate using LLM" modes.
 * Ticking a table selects all its columns; "Choose columns" expands the
 * table so individual columns can be unticked. Unticking a table's last
 * column deselects the table.
 */
export function AutoColumnPicker({ tables, columnsOf, value, onChange }: AutoColumnPickerProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const setTable = (table: string, columns: string[]) => {
    const next = { ...value };
    if (columns.length) next[table] = columns;
    else delete next[table];
    onChange(next);
  };

  // Fully selected -> none; partly or not selected -> all columns.
  const toggleTable = (table: string) => {
    const all = columnsOf(table);
    setTable(table, (value[table]?.length ?? 0) === all.length ? [] : all);
  };

  const toggleColumn = (table: string, column: string) => {
    const current = value[table] ?? [];
    const next = current.includes(column) ? current.filter((c) => c !== column) : [...current, column];
    // Keep the table's own column order rather than click order.
    setTable(table, columnsOf(table).filter((c) => next.includes(c)));
  };

  const selectAllTables = () =>
    onChange(Object.fromEntries(tables.map((t) => [t, value[t]?.length ? value[t] : columnsOf(t)])));

  return (
    <div className="form-field">
      <div className="settings-panel-header-actions" style={{ justifyContent: 'space-between' }}>
        <label>Select tables and columns</label>
        <div className="form-actions-right">
          <Button variant="ghost" size="sm" onClick={selectAllTables}>
            All tables
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onChange({})}>
            Select none
          </Button>
        </div>
      </div>
      <ul className="table-select-list">
        {tables.map((table) => {
          const all = columnsOf(table);
          const chosen = value[table] ?? [];
          const isOpen = !!expanded[table];
          return (
            <li key={table} className="column-picker-table">
              <div className="column-picker-row">
                <label>
                  <TriStateCheckbox
                    checked={chosen.length > 0 && chosen.length === all.length}
                    indeterminate={chosen.length > 0 && chosen.length < all.length}
                    onChange={() => toggleTable(table)}
                  />
                  {table}
                </label>
                <span className="column-picker-count">
                  {chosen.length ? `${chosen.length} of ${all.length} columns` : `${all.length} columns`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded((prev) => ({ ...prev, [table]: !isOpen }))}
                >
                  {isOpen ? 'Hide columns' : 'Choose columns'}
                </Button>
              </div>
              {isOpen && (
                <div className="column-picker-columns">
                  <div className="column-picker-columns-actions">
                    <Button variant="ghost" size="sm" onClick={() => setTable(table, all)}>
                      All
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setTable(table, [])}>
                      None
                    </Button>
                  </div>
                  <ul>
                    {all.map((column) => (
                      <li key={column}>
                        <label>
                          <input
                            type="checkbox"
                            checked={chosen.includes(column)}
                            onChange={() => toggleColumn(table, column)}
                          />
                          {column}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TriStateCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} />;
}
