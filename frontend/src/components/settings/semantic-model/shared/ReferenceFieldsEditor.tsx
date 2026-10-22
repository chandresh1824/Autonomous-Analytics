import { useMemo } from 'react';
import type { ReferenceDefinition, SemanticModel } from '@/types/api';
import { defaultReference, entityColumns } from './modelHelpers';
import { CARDINALITY_OPTIONS, CROSS_FILTER_OPTIONS } from './options';

/** The reference/relationship fields shared by the Dimensions tab's
 * per-dimension editor and the Relationships tab's full CRUD editor - both
 * operate on the exact same `Dimension.reference` shape, so this is the one
 * place that logic lives. Fully controlled: the parent owns the `value`. */
export function ReferenceFieldsEditor({
  model,
  value,
  onChange,
  disabled,
  excludeEntity,
}: {
  model: SemanticModel;
  value: ReferenceDefinition | null;
  onChange: (next: ReferenceDefinition | null) => void;
  disabled?: boolean;
  /** The entity this reference lives ON - offered as a target too (a
   * self-reference, e.g. a hierarchy's "parent" column, is legitimate), but
   * used to pick a sensible non-self default when first enabling a
   * reference. */
  excludeEntity?: string;
}) {
  const targetEntityColumns = useMemo(
    () => entityColumns(model.entities.find((e) => e.name === value?.target_entity)),
    [model, value?.target_entity],
  );

  const toggleEnabled = (checked: boolean) => {
    onChange(checked ? defaultReference(model, excludeEntity) : null);
  };

  const changeTargetEntity = (nextEntity: string) => {
    if (!value) return;
    const cols = entityColumns(model.entities.find((e) => e.name === nextEntity));
    onChange({
      ...value,
      target_entity: nextEntity,
      target_key: cols.includes(value.target_key) ? value.target_key : cols[0] ?? '',
    });
  };

  return (
    <>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={!!value}
          disabled={disabled}
          onChange={(e) => toggleEnabled(e.target.checked)}
        />
        References another entity
      </label>

      {value && (
        <>
          <div className="form-field">
            <label htmlFor="ref-target-entity">Target entity</label>
            <select
              id="ref-target-entity"
              value={value.target_entity}
              disabled={disabled}
              onChange={(e) => changeTargetEntity(e.target.value)}
            >
              {model.entities.map((e) => (
                <option key={e.name} value={e.name}>
                  {e.name} ({e.table_name})
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="ref-target-key">Target column</label>
            <select
              id="ref-target-key"
              value={value.target_key}
              disabled={disabled || targetEntityColumns.length === 0}
              onChange={(e) => onChange({ ...value, target_key: e.target.value })}
            >
              {targetEntityColumns.length === 0 ? (
                <option value="">No columns available</option>
              ) : (
                targetEntityColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="form-row-2">
            <div className="form-field">
              <label htmlFor="ref-cardinality">Cardinality</label>
              <select
                id="ref-cardinality"
                value={value.cardinality}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, cardinality: e.target.value })}
              >
                {CARDINALITY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="ref-cross-filter">Cross-filter direction</label>
              <select
                id="ref-cross-filter"
                value={value.cross_filter_direction}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, cross_filter_direction: e.target.value })}
              >
                {CROSS_FILTER_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="settings-panel-subtitle">
            Cardinality and cross-filter direction are descriptive metadata for readers of this
            model - the generated SQL always joins on the exact column pair above, regardless of
            either setting.
          </p>
        </>
      )}
    </>
  );
}
