import { useSyncExternalStore } from 'react';

/**
 * Whether the sign-in needs renewing with the user's help (Microsoft wants an
 * interactive step, or the backend rejected the token). Set from anywhere an
 * API call learns it; shown by `AuthGate` as a banner over the page that is
 * still open - never as a full-page redirect, which would throw away whatever
 * is on screen (a running chat, an unsaved form).
 */
let reauthRequired = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function markReauthRequired(): void {
  if (reauthRequired) return;
  reauthRequired = true;
  emit();
}

export function clearReauthRequired(): void {
  if (!reauthRequired) return;
  reauthRequired = false;
  emit();
}

export function isReauthRequired(): boolean {
  return reauthRequired;
}

export function useReauthRequired(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => reauthRequired,
  );
}
