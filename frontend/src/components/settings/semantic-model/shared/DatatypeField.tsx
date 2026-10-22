import { CUSTOM_DATATYPE, DATATYPE_OPTIONS } from './options';

/** A datatype `<select>` of common semantic types, with a "Custom…" escape
 * hatch revealing a free-text input for anything else - datatype is a
 * semantic-model property here, never read back from (or written to) the
 * underlying database schema. */
export function DatatypeField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const isKnown = DATATYPE_OPTIONS.includes(value);
  return (
    <div className="form-field">
      <label htmlFor={id}>Type</label>
      <select
        id={id}
        value={isKnown ? value : CUSTOM_DATATYPE}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value !== CUSTOM_DATATYPE) onChange(e.target.value);
          else if (isKnown) onChange('');
        }}
      >
        {DATATYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
        <option value={CUSTOM_DATATYPE}>Custom…</option>
      </select>
      {!isKnown && (
        <input value={value} placeholder="Custom datatype" disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
