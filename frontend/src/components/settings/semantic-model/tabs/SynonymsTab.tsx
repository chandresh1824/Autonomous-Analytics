import { useMemo, useState } from 'react';
import type { SemanticModel } from '@/types/api';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { TagInput } from '@/components/common/TagInput';
import { useToast } from '@/components/common/Toast';
import { useImportSemanticModel, useSuggestSynonyms } from '@/features/semantic-model/hooks';
import { getApiErrorMessage } from '@/services/apiClient';

type SynonymKind = 'dimension' | 'measure';

interface SynonymField {
  key: string;
  entityName: string;
  kind: SynonymKind;
  fieldName: string;
  description: string;
  synonyms: string[];
}

function synonymFieldKey(entityName: string, kind: SynonymKind, fieldName: string): string {
  return `${entityName}::${kind}::${fieldName}`;
}

export function SynonymsTab({ model, connectionId }: { model: SemanticModel; connectionId?: string }) {
  const toast = useToast();
  const importModel = useImportSemanticModel();
  const suggestSynonyms = useSuggestSynonyms();
  const [query, setQuery] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});

  const fields: SynonymField[] = useMemo(
    () =>
      model.entities.flatMap((entity) => [
        ...entity.dimensions.map((dim) => ({
          key: synonymFieldKey(entity.name, 'dimension' as const, dim.name),
          entityName: entity.name,
          kind: 'dimension' as const,
          fieldName: dim.name,
          description: dim.description,
          synonyms: dim.synonyms,
        })),
        ...entity.measures.map((measure) => ({
          key: synonymFieldKey(entity.name, 'measure' as const, measure.name),
          entityName: entity.name,
          kind: 'measure' as const,
          fieldName: measure.name,
          description: measure.description ?? '',
          synonyms: measure.synonyms,
        })),
      ]),
    [model],
  );

  const currentSynonyms = (field: SynonymField): string[] => overrides[field.key] ?? field.synonyms;

  const setFieldSynonyms = (field: SynonymField, next: string[]) => {
    setOverrides((prev) => ({ ...prev, [field.key]: next }));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
      (f) =>
        f.fieldName.toLowerCase().includes(q) ||
        f.entityName.toLowerCase().includes(q) ||
        currentSynonyms(f).some((s) => s.toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, query, overrides]);

  const handleGenerate = async (field: SynonymField) => {
    try {
      const generated = await suggestSynonyms.mutateAsync({
        entity_name: field.entityName,
        field_name: field.fieldName,
        description: field.description,
      });
      const merged = Array.from(new Set([...currentSynonyms(field), ...generated]));
      setFieldSynonyms(field, merged);
      toast.success(`Suggested ${generated.length} synonym(s) for "${field.fieldName}" - review, then Save changes.`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to generate synonyms.'));
    }
  };

  const dirtyCount = Object.keys(overrides).length;

  const handleSaveAll = () => {
    if (dirtyCount === 0) return;
    const updatedModel: SemanticModel = {
      ...model,
      entities: model.entities.map((entity) => ({
        ...entity,
        dimensions: entity.dimensions.map((dim) => {
          const key = synonymFieldKey(entity.name, 'dimension', dim.name);
          return key in overrides ? { ...dim, synonyms: overrides[key] } : dim;
        }),
        measures: entity.measures.map((measure) => {
          const key = synonymFieldKey(entity.name, 'measure', measure.name);
          return key in overrides ? { ...measure, synonyms: overrides[key] } : measure;
        }),
      })),
    };
    importModel.mutate(
      { model: updatedModel, connectionId },
      {
        onSuccess: () => {
          toast.success('Saved synonym changes to the draft.');
          setOverrides({});
        },
        onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to save synonym changes.')),
      },
    );
  };

  return (
    <div>
      <div className="settings-panel-header-actions" style={{ justifyContent: 'space-between' }}>
        <input
          className="search-input"
          placeholder="Search dimensions and measures…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button loading={importModel.isPending} disabled={dirtyCount === 0} onClick={handleSaveAll}>
          Save changes{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
        </Button>
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="No matching fields" />
      ) : (
        <div className="synonym-group-list">
          {filtered.map((field) => (
            <div key={field.key} className="synonym-group">
              <div className="synonym-group-title">
                {field.entityName} <span className="synonym-group-dim">/ {field.fieldName}</span>
                <Badge tone="neutral">{field.kind}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={suggestSynonyms.isPending}
                  onClick={() => handleGenerate(field)}
                >
                  Generate synonyms
                </Button>
              </div>
              <TagInput
                value={currentSynonyms(field)}
                onChange={(next) => setFieldSynonyms(field, next)}
                placeholder="Add synonym…"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
