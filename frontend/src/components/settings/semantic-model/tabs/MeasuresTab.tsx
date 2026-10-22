import { useMemo, useState } from 'react';
import type { Measure, SemanticModel } from '@/types/api';
import { Button } from '@/components/common/Button';
import { IconButton } from '@/components/common/IconButton';
import { EmptyState } from '@/components/common/EmptyState';
import { Modal } from '@/components/common/Modal';
import { useToast } from '@/components/common/Toast';
import { useImportSemanticModel } from '@/features/semantic-model/hooks';
import { getApiErrorMessage } from '@/services/apiClient';
import { DatatypeField } from '../shared/DatatypeField';
import { confirmDelete } from '../shared/modelHelpers';
import { AGGREGATION_OPTIONS } from '../shared/options';

interface MeasureDraft {
  mode: 'create' | 'edit';
  entityName: string;
  originalName?: string;
  name: string;
  expression: string;
  aggregation: string;
  datatype: string;
  format: string;
  description: string;
}

export function MeasuresTab({ model, connectionId }: { model: SemanticModel; connectionId?: string }) {
  const toast = useToast();
  const importModel = useImportSemanticModel();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<MeasureDraft | null>(null);

  const totalMeasures = model.entities.reduce((sum, e) => sum + e.measures.length, 0);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return model.entities;
    return model.entities
      .map((entity) => ({
        ...entity,
        measures: entity.measures.filter(
          (measure) =>
            measure.name.toLowerCase().includes(q) ||
            measure.expression.toLowerCase().includes(q) ||
            (measure.description ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter((entity) => entity.measures.length > 0);
  }, [model, query]);

  const openEdit = (entityName: string, measure: Measure) => {
    setDraft({
      mode: 'edit',
      entityName,
      originalName: measure.name,
      name: measure.name,
      expression: measure.expression,
      aggregation: measure.aggregation,
      datatype: measure.datatype,
      format: measure.format ?? '',
      description: measure.description ?? '',
    });
  };

  const openCreate = () => {
    setDraft({
      mode: 'create',
      entityName: model.entities[0]?.name ?? '',
      name: '',
      expression: '',
      aggregation: 'sum',
      datatype: 'int',
      format: '',
      description: '',
    });
  };

  const closeEditor = () => {
    if (importModel.isPending) return;
    setDraft(null);
  };

  const save = (updatedModel: SemanticModel, successMessage: string) => {
    importModel.mutate(
      { model: updatedModel, connectionId },
      {
        onSuccess: () => {
          toast.success(successMessage);
          setDraft(null);
        },
        onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to save changes.')),
      },
    );
  };

  const handleSave = () => {
    if (!draft) return;
    const nextMeasure: Measure = {
      name: draft.name,
      expression: draft.expression,
      aggregation: draft.aggregation,
      datatype: draft.datatype,
      format: draft.format || null,
      description: draft.description || null,
      synonyms: [],
    };
    if (draft.mode === 'edit') {
      const existing = model.entities
        .find((e) => e.name === draft.entityName)
        ?.measures.find((m) => m.name === draft.originalName);
      nextMeasure.synonyms = existing?.synonyms ?? [];
    }
    const updatedModel: SemanticModel = {
      ...model,
      entities: model.entities.map((entity) => {
        if (entity.name !== draft.entityName) return entity;
        if (draft.mode === 'create') {
          return { ...entity, measures: [...entity.measures, nextMeasure] };
        }
        return {
          ...entity,
          measures: entity.measures.map((m) => (m.name === draft.originalName ? nextMeasure : m)),
        };
      }),
    };
    save(updatedModel, draft.mode === 'create' ? 'Added measure to the draft.' : 'Saved measure to the draft.');
  };

  const handleDelete = (entityName: string, measureName: string) => {
    if (!confirmDelete(`measure "${measureName}"`)) return;
    const updatedModel: SemanticModel = {
      ...model,
      entities: model.entities.map((entity) =>
        entity.name !== entityName
          ? entity
          : { ...entity, measures: entity.measures.filter((m) => m.name !== measureName) },
      ),
    };
    save(updatedModel, `Removed measure "${measureName}" in the draft.`);
  };

  const nameTaken =
    !!draft &&
    model.entities
      .find((e) => e.name === draft.entityName)
      ?.measures.some((m) => m.name === draft.name && m.name !== draft.originalName);
  const canSave = !!draft && draft.entityName && draft.name.trim() && draft.expression.trim() && !nameTaken;

  return (
    <div>
      <div className="settings-panel-header-actions" style={{ justifyContent: 'space-between' }}>
        <input
          className="search-input"
          placeholder="Filter measures…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button variant="secondary" size="sm" onClick={openCreate} disabled={model.entities.length === 0}>
          + Add measure
        </Button>
      </div>
      {totalMeasures === 0 ? (
        <EmptyState title="No measures defined" />
      ) : groups.length === 0 ? (
        <EmptyState title="No matching measures" />
      ) : (
        <div className="grouped-list">
          {groups.map(
            (entity) =>
              entity.measures.length > 0 && (
                <div key={entity.name} className="grouped-list-section">
                  <h4>{entity.name}</h4>
                  <div className="settings-table-wrap">
                    <table className="settings-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Expression</th>
                          <th>Aggregation</th>
                          <th>Type</th>
                          <th>Format</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {entity.measures.map((measure) => (
                          <tr key={measure.name}>
                            <td className="settings-table-primary">{measure.name}</td>
                            <td className="mono-cell">{measure.expression}</td>
                            <td>{measure.aggregation}</td>
                            <td>{measure.datatype}</td>
                            <td>{measure.format ?? '–'}</td>
                            <td>
                              <div className="settings-table-actions">
                                <IconButton
                                  icon="edit"
                                  label={`Edit ${measure.name}`}
                                  variant="ghost"
                                  size="xs"
                                  round={false}
                                  onClick={() => openEdit(entity.name, measure)}
                                />
                                <IconButton
                                  icon="trash"
                                  label={`Delete ${measure.name}`}
                                  variant="ghost"
                                  size="xs"
                                  round={false}
                                  tone="danger"
                                  onClick={() => handleDelete(entity.name, measure.name)}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ),
          )}
        </div>
      )}

      <Modal
        open={!!draft}
        onClose={closeEditor}
        title={draft?.mode === 'create' ? 'Add measure' : `Edit measure: ${draft?.originalName ?? ''}`}
        width={480}
        dismissable={!importModel.isPending}
      >
        {draft && (
          <div className="form-grid">
            {draft.mode === 'create' && (
              <div className="form-field">
                <label htmlFor="measure-entity">Entity</label>
                <select
                  id="measure-entity"
                  value={draft.entityName}
                  disabled={importModel.isPending}
                  onChange={(e) => setDraft({ ...draft, entityName: e.target.value })}
                >
                  {model.entities.map((e) => (
                    <option key={e.name} value={e.name}>
                      {e.name} ({e.table_name})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-field">
              <label htmlFor="measure-name">Name</label>
              <input
                id="measure-name"
                value={draft.name}
                disabled={importModel.isPending}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              {nameTaken && <span className="settings-table-muted">A measure with this name already exists here.</span>}
            </div>
            <div className="form-field">
              <label htmlFor="measure-expression">Column</label>
              <input
                id="measure-expression"
                className="mono-cell"
                value={draft.expression}
                disabled={importModel.isPending}
                placeholder="real_numeric_column"
                onChange={(e) => setDraft({ ...draft, expression: e.target.value })}
              />
            </div>
            <div className="form-row-2">
              <div className="form-field">
                <label htmlFor="measure-aggregation">Aggregation</label>
                <select
                  id="measure-aggregation"
                  value={draft.aggregation}
                  disabled={importModel.isPending}
                  onChange={(e) => setDraft({ ...draft, aggregation: e.target.value })}
                >
                  {AGGREGATION_OPTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
              <DatatypeField
                id="measure-datatype"
                value={draft.datatype}
                disabled={importModel.isPending}
                onChange={(datatype) => setDraft({ ...draft, datatype })}
              />
            </div>
            <div className="form-field">
              <label htmlFor="measure-format">Format</label>
              <input
                id="measure-format"
                value={draft.format}
                placeholder="number, currency, percent…"
                disabled={importModel.isPending}
                onChange={(e) => setDraft({ ...draft, format: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label htmlFor="measure-description">Description</label>
              <textarea
                id="measure-description"
                value={draft.description}
                disabled={importModel.isPending}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>

            <div className="form-actions">
              <div />
              <div className="form-actions-right">
                <Button variant="ghost" disabled={importModel.isPending} onClick={closeEditor}>
                  Cancel
                </Button>
                <Button loading={importModel.isPending} disabled={!canSave} onClick={handleSave}>
                  Save draft
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
