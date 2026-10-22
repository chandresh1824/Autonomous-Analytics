import { useMemo } from 'react';
import type { FilterNode } from '@/types/api';
import type { SemanticFieldGroup } from '@/utils/semanticFields';
import { Button } from '@/components/common/Button';
import { IconButton } from '@/components/common/IconButton';
import { TagInput } from '@/components/common/TagInput';

// "exists"/"not_exists" are deliberately excluded here - a plain filter
// condition compiles them as a literal comparison operator, not the
// IS NULL/IS NOT NULL check their name implies (that's only handled
// correctly for a KPI's *reference*-condition filters), so offering them in
// this builder would silently generate broken SQL.
const OPERATORS: { value: string; label: string; multiValue?: boolean }[] = [
  { value: 'eq', label: '= equals' },
  { value: 'neq', label: '≠ not equals' },
  { value: 'gt', label: '> greater than' },
  { value: 'gte', label: '≥ greater or equal' },
  { value: 'lt', label: '< less than' },
  { value: 'lte', label: '≤ less or equal' },
  { value: 'contains', label: 'contains' },
  { value: 'in', label: 'in (any of)', multiValue: true },
  { value: 'not_in', label: 'not in (none of)', multiValue: true },
];

interface SimpleCondition {
  type: 'condition';
  field: string;
  op: string;
  value: unknown;
}

function isSimpleCondition(node: unknown): node is SimpleCondition {
  if (!node || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;
  return (n.type === undefined || n.type === 'condition') && typeof n.field === 'string' && typeof n.op === 'string';
}

function coerceScalarValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function valueToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function valueToList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  return [];
}

interface FilterConditionsEditorProps {
  value: FilterNode[];
  onChange: (value: FilterNode[]) => void;
  fieldGroups: SemanticFieldGroup[];
}

/** Structured field/operator/value builder for a KPI's flat `default_filters`
 * list, sourced from the semantic model's own measures and dimensions
 * instead of free-typed JSON. Falls back to a read-only JSON view for any
 * entry that isn't a plain `{type: "condition", field, op, value}` shape
 * (e.g. a nested group or reference condition) - those still need the
 * advanced JSON editor rather than risk mangling them here. */
export function FilterConditionsEditor({ value, onChange, fieldGroups }: FilterConditionsEditorProps) {
  const allFields = useMemo(() => fieldGroups.flatMap((g) => g.options), [fieldGroups]);

  const addCondition = () => {
    const firstField = allFields[0];
    onChange([
      ...value,
      { type: 'condition', field: firstField?.fieldName ?? '', op: 'eq', value: '' } satisfies SimpleCondition,
    ]);
  };

  const updateAt = (index: number, patch: Partial<SimpleCondition>) => {
    onChange(value.map((entry, i) => (i === index ? { ...(entry as unknown as SimpleCondition), ...patch } : entry)));
  };

  const changeOperator = (index: number, entry: SimpleCondition, nextOp: string) => {
    const wasMultiValue = !!OPERATORS.find((o) => o.value === entry.op)?.multiValue;
    const isMultiValue = !!OPERATORS.find((o) => o.value === nextOp)?.multiValue;
    // Switching between a list op (in/not_in) and a scalar op needs a value
    // reset - a leftover array wouldn't render sensibly in a plain text
    // input, and vice versa.
    const nextValue = wasMultiValue === isMultiValue ? entry.value : isMultiValue ? [] : '';
    updateAt(index, { op: nextOp, value: nextValue });
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="filter-conditions-editor">
      {value.length === 0 && <p className="settings-table-muted">No filters - this KPI/metric applies to every row.</p>}
      {value.map((entry, index) => {
        if (!isSimpleCondition(entry)) {
          return (
            <div className="filter-condition-row filter-condition-row-advanced" key={index}>
              <pre className="mono-cell filter-condition-advanced-json">{JSON.stringify(entry, null, 2)}</pre>
              <span className="settings-table-muted">Complex condition - edit via the JSON view below.</span>
              <IconButton
                icon="trash"
                label="Remove this condition"
                variant="ghost"
                size="xs"
                round={false}
                tone="danger"
                onClick={() => removeAt(index)}
              />
            </div>
          );
        }
        const operator = OPERATORS.find((o) => o.value === entry.op);
        return (
          <div className="filter-condition-row" key={index}>
            <select
              value={entry.field}
              onChange={(e) => updateAt(index, { field: e.target.value })}
              aria-label="Field"
            >
              <option value="">Select a field…</option>
              {fieldGroups.map((group) => (
                <optgroup key={group.entityName} label={group.entityName}>
                  {group.options.map((opt) => (
                    <option key={opt.key} value={opt.fieldName}>
                      {opt.fieldName} {opt.kind === 'measure' ? '(measure)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
              {/* Keeps an existing field selectable even if it no longer matches
                  any current measure/dimension name (e.g. after a schema change). */}
              {entry.field && !allFields.some((f) => f.fieldName === entry.field) && (
                <option value={entry.field}>{entry.field} (not in current model)</option>
              )}
            </select>

            <select value={entry.op} onChange={(e) => changeOperator(index, entry, e.target.value)} aria-label="Operator">
              {OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>

            {operator?.multiValue ? (
              <TagInput
                value={valueToList(entry.value)}
                onChange={(v) => updateAt(index, { value: v })}
                placeholder="value, value, …"
              />
            ) : (
              <input
                value={valueToText(entry.value)}
                onChange={(e) => updateAt(index, { value: coerceScalarValue(e.target.value) })}
                placeholder="Value"
              />
            )}

            <IconButton
              icon="trash"
              label="Remove this condition"
              variant="ghost"
              size="xs"
              round={false}
              tone="danger"
              onClick={() => removeAt(index)}
            />
          </div>
        );
      })}
      <Button type="button" variant="ghost" size="sm" onClick={addCondition} disabled={allFields.length === 0}>
        + Add filter
      </Button>
    </div>
  );
}
