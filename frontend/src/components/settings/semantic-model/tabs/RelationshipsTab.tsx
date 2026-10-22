import { useMemo, useState } from 'react';
import type { ReferenceDefinition, SemanticModel } from '@/types/api';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { IconButton } from '@/components/common/IconButton';
import { EmptyState } from '@/components/common/EmptyState';
import { Modal } from '@/components/common/Modal';
import { useToast } from '@/components/common/Toast';
import { useImportSemanticModel } from '@/features/semantic-model/hooks';
import { getApiErrorMessage } from '@/services/apiClient';
import { ReferenceFieldsEditor } from '../shared/ReferenceFieldsEditor';
import { confirmDelete, defaultReference } from '../shared/modelHelpers';

interface RelationshipRow {
  key: string;
  sourceEntity: string;
  sourceDimension: string;
  from: string;
  to: string;
  reference: ReferenceDefinition;
}

interface RelationshipDraft {
  mode: 'create' | 'edit';
  sourceEntity: string;
  sourceDimension: string;
  reference: ReferenceDefinition;
}

export function RelationshipsTab({ model, connectionId }: { model: SemanticModel; connectionId?: string }) {
  const toast = useToast();
  const importModel = useImportSemanticModel();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<RelationshipDraft | null>(null);

  const relationships: RelationshipRow[] = useMemo(
    () =>
      model.entities.flatMap((entity) =>
        entity.dimensions
          .filter((dim) => dim.reference)
          .map((dim) => ({
            key: `${entity.name}.${dim.name}`,
            sourceEntity: entity.name,
            sourceDimension: dim.name,
            from: `${entity.name}.${dim.name}`,
            to: `${dim.reference!.target_entity}.${dim.reference!.target_key}`,
            reference: dim.reference!,
          })),
      ),
    [model],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return relationships;
    return relationships.filter(
      (rel) =>
        rel.from.toLowerCase().includes(q) ||
        rel.to.toLowerCase().includes(q) ||
        rel.reference.cardinality.toLowerCase().includes(q),
    );
  }, [relationships, query]);

  const sourceEntityDimensions = useMemo(
    () => model.entities.find((e) => e.name === draft?.sourceEntity)?.dimensions ?? [],
    [model, draft?.sourceEntity],
  );

  const openCreate = () => {
    const firstEntity = model.entities[0]?.name ?? '';
    const firstDim = model.entities[0]?.dimensions[0]?.name ?? '';
    setDraft({
      mode: 'create',
      sourceEntity: firstEntity,
      sourceDimension: firstDim,
      reference: defaultReference(model, firstEntity),
    });
  };

  const openEdit = (row: RelationshipRow) => {
    setDraft({ mode: 'edit', sourceEntity: row.sourceEntity, sourceDimension: row.sourceDimension, reference: row.reference });
  };

  const closeEditor = () => {
    if (importModel.isPending) return;
    setDraft(null);
  };

  const applyReference = (sourceEntity: string, sourceDimension: string, reference: ReferenceDefinition | null) => {
    const updatedModel: SemanticModel = {
      ...model,
      entities: model.entities.map((entity) =>
        entity.name !== sourceEntity
          ? entity
          : {
              ...entity,
              dimensions: entity.dimensions.map((dim) =>
                dim.name !== sourceDimension ? dim : { ...dim, reference },
              ),
            },
      ),
    };
    return updatedModel;
  };

  const handleSave = () => {
    if (!draft) return;
    const updatedModel = applyReference(draft.sourceEntity, draft.sourceDimension, draft.reference);
    importModel.mutate(
      { model: updatedModel, connectionId },
      {
        onSuccess: () => {
          toast.success(
            draft.mode === 'create' ? 'Added relationship to the draft.' : 'Saved relationship to the draft.',
          );
          setDraft(null);
        },
        onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to save the relationship.')),
      },
    );
  };

  const handleDelete = (row: RelationshipRow) => {
    if (!confirmDelete(`the relationship ${row.from} → ${row.to}`)) return;
    const updatedModel = applyReference(row.sourceEntity, row.sourceDimension, null);
    importModel.mutate(
      { model: updatedModel, connectionId },
      {
        onSuccess: () => toast.success('Removed the relationship in the draft.'),
        onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to remove the relationship.')),
      },
    );
  };

  const canSave = !!draft && draft.sourceEntity && draft.sourceDimension && draft.reference.target_key;

  return (
    <div>
      <div className="settings-panel-header-actions" style={{ justifyContent: 'space-between' }}>
        <input
          className="search-input"
          placeholder="Filter relationships…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button variant="secondary" size="sm" onClick={openCreate} disabled={model.entities.length === 0}>
          + Add relationship
        </Button>
      </div>
      {relationships.length === 0 ? (
        <EmptyState title="No relationships defined" description="No dimensions reference another entity yet." />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching relationships" />
      ) : (
        <ul className="relationship-list">
          {filtered.map((rel) => (
            <li key={rel.key} className="relationship-item">
              <span className="mono-cell">{rel.from}</span>
              <span className="relationship-arrow">&rarr;</span>
              <span className="mono-cell">{rel.to}</span>
              <Badge tone="neutral">{rel.reference.cardinality}</Badge>
              <Badge tone="neutral">{rel.reference.cross_filter_direction}-direction</Badge>
              <div className="settings-table-actions">
                <IconButton
                  icon="edit"
                  label="Edit relationship"
                  variant="ghost"
                  size="xs"
                  round={false}
                  onClick={() => openEdit(rel)}
                />
                <IconButton
                  icon="trash"
                  label="Delete relationship"
                  variant="ghost"
                  size="xs"
                  round={false}
                  tone="danger"
                  onClick={() => handleDelete(rel)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!draft}
        onClose={closeEditor}
        title={draft?.mode === 'create' ? 'Add relationship' : 'Edit relationship'}
        width={480}
        dismissable={!importModel.isPending}
      >
        {draft && (
          <div className="form-grid">
            <div className="form-row-2">
              <div className="form-field">
                <label htmlFor="rel-source-entity">Source entity</label>
                <select
                  id="rel-source-entity"
                  value={draft.sourceEntity}
                  disabled={draft.mode === 'edit' || importModel.isPending}
                  onChange={(e) => {
                    const nextEntity = e.target.value;
                    const firstDim = model.entities.find((en) => en.name === nextEntity)?.dimensions[0]?.name ?? '';
                    setDraft({ ...draft, sourceEntity: nextEntity, sourceDimension: firstDim });
                  }}
                >
                  {model.entities.map((e) => (
                    <option key={e.name} value={e.name}>
                      {e.name} ({e.table_name})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="rel-source-dimension">Source column</label>
                <select
                  id="rel-source-dimension"
                  value={draft.sourceDimension}
                  disabled={draft.mode === 'edit' || importModel.isPending || sourceEntityDimensions.length === 0}
                  onChange={(e) => setDraft({ ...draft, sourceDimension: e.target.value })}
                >
                  {sourceEntityDimensions.length === 0 ? (
                    <option value="">No dimensions available</option>
                  ) : (
                    sourceEntityDimensions.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name} ({d.column_name})
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="settings-table-muted">references</span>
            </div>

            <ReferenceFieldsEditor
              model={model}
              value={draft.reference}
              disabled={importModel.isPending}
              excludeEntity={draft.sourceEntity}
              onChange={(reference) => setDraft({ ...draft, reference: reference ?? defaultReference(model, draft.sourceEntity) })}
            />

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
