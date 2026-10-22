import { useMemo, useState } from 'react';
import type { SemanticModel } from '@/types/api';
import { Button } from '@/components/common/Button';
import { IconButton } from '@/components/common/IconButton';
import { useToast } from '@/components/common/Toast';
import { useImportSemanticModel, useValidateSemanticModel } from '@/features/semantic-model/hooks';
import { getApiErrorMessage } from '@/services/apiClient';

export function JsonPreviewTab({ model, connectionId }: { model: SemanticModel; connectionId?: string }) {
  const toast = useToast();
  const json = useMemo(() => JSON.stringify(model, null, 2), [model]);
  const validateModel = useValidateSemanticModel();
  const importModel = useImportSemanticModel();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(json);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      toast.success('Copied semantic model JSON to clipboard.');
    } catch {
      toast.error('Could not copy to clipboard.');
    }
  };

  const startEditing = () => {
    setDraft(json);
    setValidationResult(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setValidationResult(null);
  };

  const parseDraft = (): SemanticModel | null => {
    try {
      return JSON.parse(draft) as SemanticModel;
    } catch (err) {
      toast.error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  const handleValidate = () => {
    const parsed = parseDraft();
    if (!parsed) return;
    validateModel.mutate(parsed, {
      onSuccess: (result) => {
        setValidationResult(result);
        if (result.valid) toast.success('Semantic model is valid.');
        else toast.error('Semantic model has validation errors.');
      },
      onError: (err) => toast.error(getApiErrorMessage(err, 'Validation failed.')),
    });
  };

  const handleSave = () => {
    const parsed = parseDraft();
    if (!parsed) return;
    importModel.mutate({ model: parsed, connectionId }, {
      onSuccess: (result) => {
        setValidationResult(result);
        toast.success('Saved your edits to the draft.');
        setEditing(false);
      },
      onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to save changes.')),
    });
  };

  return (
    <div className="json-preview">
      <div className="json-preview-toolbar">
        {editing ? (
          <>
            <Button variant="ghost" size="sm" onClick={cancelEditing}>
              Cancel
            </Button>
            <Button variant="secondary" size="sm" loading={validateModel.isPending} onClick={handleValidate}>
              Validate
            </Button>
            <Button size="sm" loading={importModel.isPending} onClick={handleSave}>
              Save draft
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={copy}>
              Copy JSON
            </Button>
            <IconButton
              icon="edit"
              label="Edit JSON"
              variant="outline"
              size="sm"
              round={false}
              onClick={startEditing}
            />
          </>
        )}
      </div>

      {validationResult && (
        <div className={`test-result ${validationResult.valid ? 'test-result-success' : 'test-result-error'}`}>
          <strong>{validationResult.valid ? 'Valid' : 'Invalid'}</strong>
          {validationResult.errors.length > 0 && (
            <ul>
              {validationResult.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {validationResult.warnings.length > 0 && (
            <ul className="validation-warnings">
              {validationResult.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing ? (
        <textarea
          className="mono-textarea json-edit-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <pre className="json-preview-block">{json}</pre>
      )}
    </div>
  );
}
