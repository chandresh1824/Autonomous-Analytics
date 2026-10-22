import { useMemo, useState } from 'react';
import type { Entity, SemanticModel } from '@/types/api';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { IconButton } from '@/components/common/IconButton';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { useToast } from '@/components/common/Toast';
import { useDatasourceTables, useImportSemanticModel } from '@/features/semantic-model/hooks';
import { getApiErrorMessage } from '@/services/apiClient';
import { confirmDelete, titleCase } from '../shared/modelHelpers';

interface EntityDraft {
  tableName: string;
  name: string;
  description: string;
  primaryKeys: string[];
}

const EMPTY_DRAFT: EntityDraft = { tableName: '', name: '', description: '', primaryKeys: [] };

/** Why an entity can't be deleted yet, or null when nothing depends on it:
 * it must have no dimensions or measures, and no relationship, metric, or
 * KPI may refer to it. */
function deleteBlocker(model: SemanticModel, entity: Entity): string | null {
  if (entity.dimensions.length > 0 || entity.measures.length > 0) {
    return 'Remove its dimensions and measures first.';
  }
  const referencedByRelationship = model.entities.some(
    (e) => e.name !== entity.name && e.dimensions.some((d) => d.reference?.target_entity === entity.name),
  );
  if (referencedByRelationship) return 'Another entity has a relationship to it - remove that first.';
  const prefix = `${entity.name}.`;
  const mentions = (refs: (string | null | undefined)[]) => refs.some((r) => !!r && r.startsWith(prefix));
  if ((model.metrics ?? []).some((m) => mentions([m.base_measure, ...m.supported_dimensions]))) {
    return 'A metric refers to it - remove that first.';
  }
  if ((model.kpis ?? []).some((k) => mentions([...k.supported_dimensions, ...k.required_grouping_dimensions]))) {
    return 'A KPI refers to it - remove that first.';
  }
  return null;
}

export function EntitiesTab({ model, connectionId }: { model: SemanticModel; connectionId?: string }) {
  const toast = useToast();
  const importModel = useImportSemanticModel();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<EntityDraft | null>(null);
  // Only loaded once the editor opens - the list itself doesn't need it.
  const tablesQuery = useDatasourceTables(draft ? connectionId ?? '' : '');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return model.entities;
    return model.entities.filter(
      (entity) =>
        entity.name.toLowerCase().includes(q) ||
        entity.table_name.toLowerCase().includes(q) ||
        entity.description.toLowerCase().includes(q),
    );
  }, [model, query]);

  // A table can back only one entity, so offer only tables not modeled yet.
  const availableTables = useMemo(() => {
    const modeled = new Set(model.entities.map((e) => e.table_name));
    return (tablesQuery.data ?? []).filter((t) => !modeled.has(t.table_name));
  }, [model, tablesQuery.data]);
  const selectedTable = (tablesQuery.data ?? []).find((t) => t.table_name === draft?.tableName);

  const closeEditor = () => {
    if (importModel.isPending) return;
    setDraft(null);
  };

  const pickTable = (tableName: string) => {
    if (!draft) return;
    setDraft({ ...draft, tableName, name: tableName ? titleCase(tableName) : '', primaryKeys: [] });
  };

  const togglePrimaryKey = (column: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      primaryKeys: draft.primaryKeys.includes(column)
        ? draft.primaryKeys.filter((c) => c !== column)
        : [...draft.primaryKeys, column],
    });
  };

  const nameTaken = !!draft && model.entities.some((e) => e.name === draft.name.trim());
  const canSave = !!draft && !!draft.tableName && !!draft.name.trim() && !nameTaken;

  const handleDelete = (entity: Entity) => {
    if (deleteBlocker(model, entity) || importModel.isPending) return;
    if (!confirmDelete(`entity "${entity.name}"`)) return;
    importModel.mutate(
      { model: { ...model, entities: model.entities.filter((e) => e.name !== entity.name) }, connectionId },
      {
        onSuccess: () => toast.success(`Removed entity "${entity.name}" in the draft.`),
        onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to save changes.')),
      },
    );
  };

  const handleSave = () => {
    if (!draft || !canSave) return;
    const entity: Entity = {
      name: draft.name.trim(),
      table_name: draft.tableName,
      description: draft.description.trim(),
      primary_keys: draft.primaryKeys,
      dimensions: [],
      measures: [],
    };
    importModel.mutate(
      { model: { ...model, entities: [...model.entities, entity] }, connectionId },
      {
        onSuccess: () => {
          toast.success(`Added entity "${entity.name}" to the draft. Add its dimensions and measures in their tabs.`);
          setDraft(null);
        },
        onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to save changes.')),
      },
    );
  };

  return (
    <div>
      <div className="settings-panel-header-actions" style={{ justifyContent: 'space-between' }}>
        <input
          className="search-input"
          placeholder="Filter entities…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button variant="secondary" size="sm" onClick={() => setDraft(EMPTY_DRAFT)} disabled={!connectionId}>
          + Add entity
        </Button>
      </div>
      {model.entities.length === 0 ? (
        <EmptyState title="No entities defined" />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching entities" />
      ) : (
        <div className="entity-card-list">
          {filtered.map((entity) => {
            const blocker = deleteBlocker(model, entity);
            return (
              <div className="entity-card" key={entity.name}>
                <IconButton
                  icon="trash"
                  label={blocker ? `Can't delete ${entity.name}: ${blocker}` : `Delete ${entity.name}`}
                  variant="ghost"
                  size="xs"
                  round={false}
                  tone="danger"
                  className="entity-card-remove"
                  disabled={!!blocker || importModel.isPending}
                  onClick={() => handleDelete(entity)}
                />
                <div className="entity-card-header">
                  <h3>{entity.name}</h3>
                  <span className="entity-card-table">{entity.table_name}</span>
                </div>
                <p className="entity-card-description">{entity.description}</p>
                <div className="entity-card-meta">
                  <span>
                    Primary keys: {entity.primary_keys.length > 0 ? entity.primary_keys.join(', ') : '–'}
                  </span>
                  <span>{entity.dimensions.length} dimensions</span>
                  <span>{entity.measures.length} measures</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!draft} onClose={closeEditor} title="Add entity" width={480} dismissable={!importModel.isPending}>
        {draft && (
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="entity-table">Table</label>
              {tablesQuery.isLoading ? (
                <Spinner size={16} />
              ) : (
                <select
                  id="entity-table"
                  value={draft.tableName}
                  disabled={importModel.isPending}
                  onChange={(e) => pickTable(e.target.value)}
                >
                  <option value="">Select a table…</option>
                  {availableTables.map((t) => (
                    <option key={t.table_name} value={t.table_name}>
                      {t.table_name} ({t.column_count} columns)
                    </option>
                  ))}
                </select>
              )}
              {!tablesQuery.isLoading && availableTables.length === 0 && (
                <span className="settings-table-muted">Every table in this database is already an entity.</span>
              )}
            </div>
            <div className="form-field">
              <label htmlFor="entity-name">Name</label>
              <input
                id="entity-name"
                value={draft.name}
                disabled={importModel.isPending}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              {nameTaken && <span className="settings-table-muted">An entity with this name already exists.</span>}
            </div>
            <div className="form-field">
              <label htmlFor="entity-description">Description</label>
              <textarea
                id="entity-description"
                value={draft.description}
                disabled={importModel.isPending}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            {selectedTable && (
              <div className="form-field">
                <label>Primary keys</label>
                <ul className="table-select-list">
                  {selectedTable.columns.map((column) => (
                    <li key={column.name}>
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.primaryKeys.includes(column.name)}
                          disabled={importModel.isPending}
                          onChange={() => togglePrimaryKey(column.name)}
                        />
                        {column.name}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
