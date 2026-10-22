import { useMemo, useState } from 'react';
import type { Dimension, ReferenceDefinition, SemanticModel } from '@/types/api';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { IconButton } from '@/components/common/IconButton';
import { EmptyState } from '@/components/common/EmptyState';
import { Modal } from '@/components/common/Modal';
import { useToast } from '@/components/common/Toast';
import { useDatasourceTables, useGenerateSemanticModel, useImportSemanticModel } from '@/features/semantic-model/hooks';
import { getApiErrorMessage } from '@/services/apiClient';
import { DatatypeField } from '../shared/DatatypeField';
import { ReferenceFieldsEditor } from '../shared/ReferenceFieldsEditor';
import { confirmDelete, normalizeDbDatatype, titleCase } from '../shared/modelHelpers';
import { DATATYPE_OPTIONS } from '../shared/options';

interface DimensionEditDraft {
  entityName: string;
  originalName: string;
  name: string;
  columnName: string;
  datatype: string;
  description: string;
  reference: ReferenceDefinition | null;
}

type AddDimensionsStep = 'closed' | 'choose' | 'auto' | 'manual';

interface AddDimensionRow {
  name: string;
  columnName: string;
  datatype: string;
  description: string;
}

export function DimensionsTab({ model, connectionId }: { model: SemanticModel; connectionId?: string }) {
  const toast = useToast();
  const importModel = useImportSemanticModel();
  const generateModel = useGenerateSemanticModel();
  const tablesQuery = useDatasourceTables(connectionId ?? '');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<DimensionEditDraft | null>(null);

  // ---- Add dimensions: ask automatic-vs-manual first, then a real table,
  // then (manual) real columns from that table - never a free-typed column
  // name, since a dimension the SQL Agent can't find on the real table is
  // indistinguishable from one that doesn't exist. ----
  const [addStep, setAddStep] = useState<AddDimensionsStep>('closed');
  const [addTable, setAddTable] = useState('');
  const [addRows, setAddRows] = useState<AddDimensionRow[]>([]);

  const totalDims = model.entities.reduce((sum, e) => sum + e.dimensions.length, 0);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return model.entities;
    return model.entities
      .map((entity) => ({
        ...entity,
        dimensions: entity.dimensions.filter(
          (dim) =>
            dim.name.toLowerCase().includes(q) ||
            dim.column_name.toLowerCase().includes(q) ||
            dim.description.toLowerCase().includes(q),
        ),
      }))
      .filter((entity) => entity.dimensions.length > 0);
  }, [model, query]);

  const openEdit = (entityName: string, dim: Dimension) => {
    setDraft({
      entityName,
      originalName: dim.name,
      name: dim.name,
      columnName: dim.column_name,
      datatype: dim.datatype,
      description: dim.description,
      reference: dim.reference ?? null,
    });
  };

  const closeEditor = () => {
    if (importModel.isPending) return;
    setDraft(null);
  };

  const save = (updatedModel: SemanticModel, successMessage: string, onDone: () => void) => {
    importModel.mutate(
      { model: updatedModel, connectionId },
      {
        onSuccess: () => {
          toast.success(successMessage);
          onDone();
        },
        onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to save changes.')),
      },
    );
  };

  const handleSaveEdit = () => {
    if (!draft) return;
    const existing = model.entities
      .find((e) => e.name === draft.entityName)
      ?.dimensions.find((d) => d.name === draft.originalName);
    const nextDim: Dimension = {
      name: draft.name,
      column_name: draft.columnName,
      datatype: draft.datatype,
      description: draft.description,
      synonyms: existing?.synonyms ?? [],
      reference: draft.reference,
    };
    const updatedModel: SemanticModel = {
      ...model,
      entities: model.entities.map((entity) =>
        entity.name !== draft.entityName
          ? entity
          : { ...entity, dimensions: entity.dimensions.map((d) => (d.name === draft.originalName ? nextDim : d)) },
      ),
    };
    save(updatedModel, 'Saved dimension to the draft.', () => setDraft(null));
  };

  const handleDelete = (entityName: string, dimName: string) => {
    if (!confirmDelete(`dimension "${dimName}"`)) return;
    const updatedModel: SemanticModel = {
      ...model,
      entities: model.entities.map((entity) =>
        entity.name !== entityName
          ? entity
          : { ...entity, dimensions: entity.dimensions.filter((d) => d.name !== dimName) },
      ),
    };
    save(updatedModel, `Removed dimension "${dimName}" in the draft.`, () => {});
  };

  const nameTaken =
    !!draft &&
    model.entities
      .find((e) => e.name === draft.entityName)
      ?.dimensions.some((d) => d.name === draft.name && d.name !== draft.originalName);
  const canSaveEdit = !!draft && draft.name.trim() && draft.columnName.trim() && !nameTaken;

  // ---- Add-dimensions flow ----

  const openAdd = () => {
    setAddStep('choose');
    setAddTable('');
    setAddRows([]);
  };

  const closeAdd = () => {
    if (importModel.isPending || generateModel.isPending) return;
    setAddStep('closed');
  };

  const entityForTable = (table: string) => model.entities.find((e) => e.table_name === table);

  const rawColumnsForTable = (table: string) => tablesQuery.data?.find((t) => t.table_name === table)?.columns ?? [];

  const availableManualColumns = (table: string) => {
    const used = new Set([
      ...(entityForTable(table)?.dimensions.map((d) => d.column_name) ?? []),
      ...addRows.map((r) => r.columnName),
    ]);
    return rawColumnsForTable(table).filter((c) => !used.has(c.name));
  };

  const changeAddTable = (table: string) => {
    setAddTable(table);
    setAddRows([]);
  };

  const generateForAdd = async () => {
    if (!addTable || !connectionId) return;
    try {
      const result = await generateModel.mutateAsync({ connectionId, tables: [addTable] });
      const generatedEntity = result.entities[0];
      const used = new Set(entityForTable(addTable)?.dimensions.map((d) => d.column_name) ?? []);
      const rows = generatedEntity.dimensions
        .filter((d) => !used.has(d.column_name))
        .map((d) => ({ name: d.name, columnName: d.column_name, datatype: d.datatype, description: d.description }));
      setAddRows(rows);
      toast.success(`Generated ${rows.length} dimension(s) for "${addTable}" - review, then save.`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, `Failed to generate dimensions for "${addTable}".`));
    }
  };

  const addManualColumn = (col: { name: string; datatype: string }) => {
    setAddRows((prev) => [
      ...prev,
      { name: titleCase(col.name), columnName: col.name, datatype: normalizeDbDatatype(col.datatype), description: '' },
    ]);
  };

  const updateAddRow = (index: number, patch: Partial<AddDimensionRow>) =>
    setAddRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const removeAddRow = (index: number) => setAddRows((prev) => prev.filter((_, i) => i !== index));

  const canSaveAdd = !!addTable && addRows.length > 0 && addRows.every((r) => r.name.trim());

  const handleSaveAdd = () => {
    if (!canSaveAdd) return;
    const newDims: Dimension[] = addRows.map((r) => ({
      name: r.name,
      column_name: r.columnName,
      datatype: r.datatype,
      description: r.description,
      synonyms: [],
      reference: null,
    }));
    const existing = entityForTable(addTable);
    const updatedModel: SemanticModel = existing
      ? {
          ...model,
          entities: model.entities.map((e) =>
            e.table_name === addTable ? { ...e, dimensions: [...e.dimensions, ...newDims] } : e,
          ),
        }
      : {
          ...model,
          entities: [
            ...model.entities,
            { name: titleCase(addTable), table_name: addTable, description: '', primary_keys: [], dimensions: newDims, measures: [] },
          ],
        };
    save(updatedModel, `Added ${newDims.length} dimension(s) to the draft.`, () => setAddStep('closed'));
  };

  return (
    <div>
      <div className="settings-panel-header-actions" style={{ justifyContent: 'space-between' }}>
        <input
          className="search-input"
          placeholder="Filter dimensions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button variant="secondary" size="sm" onClick={openAdd} disabled={!connectionId}>
          + Add dimensions
        </Button>
      </div>
      {totalDims === 0 ? (
        <EmptyState title="No dimensions defined" />
      ) : groups.length === 0 ? (
        <EmptyState title="No matching dimensions" />
      ) : (
        <div className="grouped-list">
          {groups.map(
            (entity) =>
              entity.dimensions.length > 0 && (
                <div key={entity.name} className="grouped-list-section">
                  <h4>{entity.name}</h4>
                  <div className="settings-table-wrap">
                    <table className="settings-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Column</th>
                          <th>Type</th>
                          <th>Description</th>
                          <th>Reference</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {entity.dimensions.map((dim) => (
                          <tr key={dim.name}>
                            <td className="settings-table-primary">{dim.name}</td>
                            <td className="mono-cell">{dim.column_name}</td>
                            <td>{dim.datatype}</td>
                            <td className="settings-table-muted">{dim.description}</td>
                            <td>
                              {dim.reference ? (
                                <Badge tone="accent">
                                  {dim.reference.target_entity}.{dim.reference.target_key}
                                </Badge>
                              ) : (
                                <span className="settings-table-muted">–</span>
                              )}
                            </td>
                            <td>
                              <div className="settings-table-actions">
                                <IconButton
                                  icon="edit"
                                  label={`Edit ${dim.name}`}
                                  variant="ghost"
                                  size="xs"
                                  round={false}
                                  onClick={() => openEdit(entity.name, dim)}
                                />
                                <IconButton
                                  icon="trash"
                                  label={`Delete ${dim.name}`}
                                  variant="ghost"
                                  size="xs"
                                  round={false}
                                  tone="danger"
                                  onClick={() => handleDelete(entity.name, dim.name)}
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
        title={`Edit dimension: ${draft?.originalName ?? ''}`}
        width={480}
        dismissable={!importModel.isPending}
      >
        {draft && (
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="dim-name">Name</label>
              <input
                id="dim-name"
                value={draft.name}
                disabled={importModel.isPending}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              {nameTaken && <span className="settings-table-muted">A dimension with this name already exists here.</span>}
            </div>
            <div className="form-field">
              <label htmlFor="dim-column">Column</label>
              <input id="dim-column" className="mono-cell" value={draft.columnName} disabled />
            </div>
            <DatatypeField
              id="dim-datatype"
              value={draft.datatype}
              disabled={importModel.isPending}
              onChange={(datatype) => setDraft({ ...draft, datatype })}
            />
            <div className="form-field">
              <label htmlFor="dim-description">Description</label>
              <textarea
                id="dim-description"
                value={draft.description}
                disabled={importModel.isPending}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <ReferenceFieldsEditor
              model={model}
              value={draft.reference}
              disabled={importModel.isPending}
              excludeEntity={draft.entityName}
              onChange={(reference) => setDraft({ ...draft, reference })}
            />

            <div className="form-actions">
              <div />
              <div className="form-actions-right">
                <Button variant="ghost" disabled={importModel.isPending} onClick={closeEditor}>
                  Cancel
                </Button>
                <Button loading={importModel.isPending} disabled={!canSaveEdit} onClick={handleSaveEdit}>
                  Save draft
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={addStep !== 'closed'}
        onClose={closeAdd}
        title="Add dimensions"
        width={560}
        dismissable={!importModel.isPending && !generateModel.isPending}
      >
        {addStep === 'choose' && (
          <div className="form-grid">
            <p className="settings-panel-subtitle">How do you want to add dimensions?</p>
            <div className="form-actions-right" style={{ justifyContent: 'flex-start' }}>
              <Button onClick={() => setAddStep('auto')}>Generate automatically</Button>
              <Button variant="secondary" onClick={() => setAddStep('manual')}>
                Select manually
              </Button>
            </div>
            <div className="form-actions">
              <div />
              <div className="form-actions-right">
                <Button variant="ghost" onClick={closeAdd}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {(addStep === 'auto' || addStep === 'manual') && (
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="add-dim-table">Table</label>
              <select
                id="add-dim-table"
                value={addTable}
                disabled={tablesQuery.isLoading}
                onChange={(e) => changeAddTable(e.target.value)}
              >
                <option value="">Select a table…</option>
                {(tablesQuery.data ?? []).map((t) => (
                  <option key={t.table_name} value={t.table_name}>
                    {t.table_name} ({t.column_count} columns)
                  </option>
                ))}
              </select>
            </div>

            {addStep === 'auto' && (
              <Button size="sm" loading={generateModel.isPending} disabled={!addTable} onClick={generateForAdd}>
                Generate dimensions
              </Button>
            )}

            {addStep === 'manual' && addTable && (
              <div className="form-field">
                <label>Add a column as a dimension</label>
                <select
                  value=""
                  onChange={(e) => {
                    const col = rawColumnsForTable(addTable).find((c) => c.name === e.target.value);
                    if (col) addManualColumn(col);
                  }}
                >
                  <option value="">Select a column…</option>
                  {availableManualColumns(addTable).map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {addRows.length > 0 && (
              <div className="settings-table-wrap">
                <table className="settings-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Column</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {addRows.map((row, i) => (
                      <tr key={row.columnName}>
                        <td>
                          <input value={row.name} onChange={(e) => updateAddRow(i, { name: e.target.value })} />
                        </td>
                        <td className="mono-cell">{row.columnName}</td>
                        <td style={{ minWidth: 140 }}>
                          <select value={row.datatype} onChange={(e) => updateAddRow(i, { datatype: e.target.value })}>
                            {DATATYPE_OPTIONS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                            {!DATATYPE_OPTIONS.includes(row.datatype) && <option value={row.datatype}>{row.datatype}</option>}
                          </select>
                        </td>
                        <td>
                          <input value={row.description} onChange={(e) => updateAddRow(i, { description: e.target.value })} />
                        </td>
                        <td>
                          <IconButton
                            icon="trash"
                            label="Remove this row"
                            variant="ghost"
                            size="xs"
                            round={false}
                            tone="danger"
                            onClick={() => removeAddRow(i)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="form-actions">
              <Button variant="ghost" disabled={importModel.isPending || generateModel.isPending} onClick={() => setAddStep('choose')}>
                Back
              </Button>
              <div className="form-actions-right">
                <Button variant="ghost" disabled={importModel.isPending} onClick={closeAdd}>
                  Cancel
                </Button>
                <Button loading={importModel.isPending} disabled={!canSaveAdd} onClick={handleSaveAdd}>
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
