import { RefObject, useEffect } from 'react';

/**
 * Closes a popover when the pointer goes down outside it or Escape is
 * pressed. Shared by every dropdown (the rail's user menu, the conversation
 * history menu) so the dismiss behaviour is written once.
 */
export function useDismissable(
  ref: RefObject<HTMLElement>,
  onDismiss: () => void,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, onDismiss, active]);
}
