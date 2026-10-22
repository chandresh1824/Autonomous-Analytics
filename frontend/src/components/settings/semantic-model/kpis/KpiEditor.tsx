import { FormEvent, useState } from 'react';
import type { FilterNode, KPI } from '@/types/api';
import type { SemanticFieldGroup } from '@/utils/semanticFields';
import { Button } from '@/components/common/Button';
import { Toggle } from '@/components/common/Toggle';
import { TagInput } from '@/components/common/TagInput';
import { MetricPicker } from '../metrics/MetricPicker';
import type { LocalMetricSource } from '../metrics/MetricQuickCreate';
import { FilterConditionsEditor } from '../shared/FilterConditionsEditor';

interface KpiEditorProps {
  initial?: KPI | null;
  fieldGroups: SemanticFieldGroup[];
  /** The database whose semantic model this KPI belongs to. */
  connectionId?: string;
  /** Edit against an unsaved in-memory model (the wizard) instead of the API. */
  localMetrics?: LocalMetricSource;
  onSubmit: (kpi: KPI) => void;
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

export function KpiEditor({ initial, fieldGroups, connectionId, localMetrics, onSubmit, onCancel, submitting }: KpiEditorProps) {
  const isEdit = !!initial;
  const [id, setId] = useState(initial?.id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [formula, setFormula] = useState(initial?.formula ?? '');
  const [metricIds, setMetricIds] = useState<string[]>(initial?.metric_ids ?? []);
  const [requiredDims, setRequiredDims] = useState<string[]>(
    initial?.required_grouping_dimensions ?? [],
  );
  const [supportedDims, setSupportedDims] = useState<string[]>(initial?.supported_dimensions ?? []);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [filters, setFilters] = useState<FilterNode[]>(initial?.default_filters ?? []);
  const [filterLogicText, setFilterLogicText] = useState(
    JSON.stringify(initial?.default_filter_logic ?? null, null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    let filterLogic;
    try {
      filterLogic = filterLogicText.trim() ? JSON.parse(filterLogicText) : null;
    } catch (err) {
      setJsonError(`Default Filter Logic: ${(err as Error).message}`);
      return;
    }
    setJsonError(null);

    const finalId = id.trim() || slugify(name);
    onSubmit({
      id: finalId,
      name,
      description,
      formula,
      metric_ids: metricIds,
      required_grouping_dimensions: requiredDims,
      supported_dimensions: supportedDims,
      default_filters: filters,
      default_filter_logic: filterLogic,
      enabled,
    });
  };

  return (
    <form className="form-grid" onSubmit={handleSubmit}>
      <div className="form-row-2">
        <div className="form-field">
          <label htmlFor="kpi-id">KPI ID</label>
          <input
            id="kpi-id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder={name ? slugify(name) : 'auto-generated from name'}
            disabled={isEdit}
          />
        </div>
        <div className="form-field">
          <label htmlFor="kpi-name">Name</label>
          <input id="kpi-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="kpi-description">Description</label>
        <textarea
          id="kpi-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>

      <div className="form-field">
        <label htmlFor="kpi-formula">Formula</label>
        <textarea
          id="kpi-formula"
          className="mono-textarea"
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
          rows={2}
        />
      </div>

      <div className="form-field">
        <label>Metrics used by this KPI</label>
        <MetricPicker value={metricIds} onChange={setMetricIds} connectionId={connectionId} local={localMetrics} />
      </div>

      <div className="form-row-2">
        <div className="form-field">
          <label>Required grouping dimensions</label>
          <TagInput value={requiredDims} onChange={setRequiredDims} placeholder="e.g. priority" />
        </div>
        <div className="form-field">
          <label>Supported dimensions</label>
          <TagInput value={supportedDims} onChange={setSupportedDims} placeholder="e.g. service_line" />
        </div>
      </div>

      <div className="form-field">
        <label>Default filters</label>
        <FilterConditionsEditor value={filters} onChange={setFilters} fieldGroups={fieldGroups} />
      </div>

      <div className="form-field">
        <label htmlFor="kpi-filter-logic">
          Advanced: default filter logic (JSON or null) - for AND/OR groups or cross-entity
          reference conditions, beyond what the filter builder above supports
        </label>
        <textarea
          id="kpi-filter-logic"
          className="mono-textarea"
          value={filterLogicText}
          onChange={(e) => setFilterLogicText(e.target.value)}
          rows={5}
        />
      </div>

      {jsonError && <div className="test-result test-result-error">{jsonError}</div>}

      <Toggle checked={enabled} onChange={setEnabled} label="Enabled" />

      <div className="form-actions">
        <div />
        <div className="form-actions-right">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            {isEdit ? 'Save changes' : 'Create KPI'}
          </Button>
        </div>
      </div>
    </form>
  );
}
