import type { SemanticModelVersion } from '@/types/api';

/**
 * Remembers which draft the "Add new semantic model" wizard saved, so a page
 * refresh can reopen the wizard from it. Unsaved wizard progress is never
 * stored here - it lives only in memory and a manual refresh starts fresh.
 *
 * The draft's version id identifies it: re-saving a draft updates the same
 * row, while a draft created after a publish/discard gets a new id - so a
 * mark left over from an earlier draft can never claim a different one.
 */
const STORAGE_KEY = 'aa.semanticModelWizard.savedDraft';

export interface WizardDraftMark {
  connectionId: string;
  versionId: string;
  /** Wizard step to reopen on. */
  step: string;
}

export function readWizardDraftMark(): WizardDraftMark | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WizardDraftMark) : null;
  } catch {
    return null;
  }
}

export function writeWizardDraftMark(mark: WizardDraftMark) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mark));
  } catch {
    // Storage blocked: a refresh just won't reopen the wizard.
  }
}

export function clearWizardDraftMark() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** True when this connection's pending draft is the one the wizard saved. */
export function isWizardDraft(connectionId: string | undefined, versions: SemanticModelVersion[] | undefined): boolean {
  const mark = readWizardDraftMark();
  if (!mark || !connectionId || mark.connectionId !== connectionId) return false;
  return !!versions?.some((v) => v.id === mark.versionId && v.status === 'draft');
}
