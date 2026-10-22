import { FormEvent, useMemo, useState } from 'react';
import type { FilterNode, Metric, SemanticModel } from '@/types/api';
import type { SemanticFieldGroup } from '@/utils/semanticFields';
import { Button } from '@/components/common/Button';
import { TagInput } from '@/components/common/TagInput';
import { FilterConditionsEditor } from '../shared/FilterConditionsEditor';

interface MetricEditorProps {
  initial?: Metric | null;
  model: SemanticModel;
  fieldGroups: SemanticFieldGroup[];
  onSubmit: (metric: Metric) => void;
  onCancel: () => void;
  submitting?: boolean;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Full create/edit form for a Metric (a measure plus optional default
 * filters), used by the Metrics tab. */
export function MetricEditor({ initial, model, fieldGroups, onSubmit, onCancel, submitting }: MetricEditorProps) {
  const isEdit = !!initial;
  const [id, setId] = useState(initial?.id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [baseMeasure, setBaseMeasure] = useState(initial?.base_measure ?? '');
  const [format, setFormat] = useState(initial?.format ?? '');
  const [supportedDims, setSupportedDims] = useState<string[]>(initial?.supported_dimensions ?? []);
  const [filters, setFilters] = useState<FilterNode[]>(initial?.filters ?? []);
  const [filterLogicText, setFilterLogicText] = useState(JSON.stringify(initial?.filter_logic ?? null, null, 2));
  const [error, setError] = useState<string | null>(null);

  const measureOptions = useMemo(
    () =>
      model.entities.flatMap((entity) =>
        entity.measures.map((measure) => ({ value: measure.name, label: `${entity.name} · ${measure.name}` })),
      ),
    [model],
  );
  // Keep an existing metric's measure selectable even if it no longer exists.
  const missingMeasure = baseMeasure && !measureOptions.some((m) => m.value === baseMeasure);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!baseMeasure) {
      setError('Choose a measure to base this metric on.');
      return;
    }
    let filterLogic;
    try {
      filterLogic = filterLogicText.trim() ? JSON.parse(filterLogicText) : null;
    } catch (err) {
      setError(`Filter logic: ${(err as Error).message}`);
      return;
    }
    setError(null);
    onSubmit({
      id: id.trim() || `metric_${slugify(name)}`,
      name: name.trim(),
      description,
      base_measure: baseMeasure,
      filters,
      filter_logic: filterLogic,
      supported_dimensions: supportedDims,
      format: format.trim() || null,
    });
  };

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <div className="form-row-2">
        <div className="form-field">
          <label htmlFor="metric-id">Metric ID</label>
          <input
            id="metric-id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder={name ? `metric_${slugify(name)}` : 'auto-generated from name'}
            disabled={isEdit}
          />
        </div>
        <div className="form-field">
          <label htmlFor="metric-name">Name</label>
          <input id="metric-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="metric-description">Description</label>
        <textarea
          id="metric-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>

      <div className="form-row-2">
        <div className="form-field">
          <label htmlFor="metric-measure">Based on measure</label>
          <select id="metric-measure" value={baseMeasure} onChange={(e) => setBaseMeasure(e.target.value)}>
            <option value="">Select a measure…</option>
            {missingMeasure && <option value={baseMeasure}>{baseMeasure} (not found)</option>}
            {measureOptions.map((m) => (
              <option key={m.label} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="metric-format">Format</label>
          <input
            id="metric-format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            placeholder="e.g. number, currency"
          />
        </div>
      </div>

      <div className="form-field">
        <label>Supported dimensions</label>
        <TagInput value={supportedDims} onChange={setSupportedDims} placeholder="e.g. service_line" />
      </div>

      <div className="form-field">
        <label>Filters</label>
        <FilterConditionsEditor value={filters} onChange={setFilters} fieldGroups={fieldGroups} />
      </div>

      <div className="form-field">
        <label htmlFor="metric-filter-logic">
          Advanced: filter logic (JSON or null) - for AND/OR groups beyond what the filter builder supports
        </label>
        <textarea
          id="metric-filter-logic"
          className="mono-textarea"
          value={filterLogicText}
          onChange={(e) => setFilterLogicText(e.target.value)}
          rows={4}
        />
      </div>

      {error && <div className="test-result test-result-error">{error}</div>}

      <div className="form-actions">
        <div />
        <div className="form-actions-right">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {isEdit ? 'Save changes' : 'Create metric'}
          </Button>
        </div>
      </div>
    </form>
  );
}
