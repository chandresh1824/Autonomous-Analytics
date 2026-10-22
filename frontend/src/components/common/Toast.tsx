import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ToastMessage {
  id: number;
  tone: 'success' | 'error' | 'info';
  text: string;
}

interface ToastContextValue {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const idRef = useRef(0);

  const push = useCallback((tone: ToastMessage['tone'], text: string) => {
    const id = ++idRef.current;
    setMessages((prev) => {
      // Repeated clicks on the same control should not stack identical
      // toasts on top of each other.
      if (prev.some((m) => m.tone === tone && m.text === text)) return prev;
      return [...prev, { id, tone, text }];
    });
    window.setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    }, 4000);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (text: string) => push('success', text),
      error: (text: string) => push('error', text),
      info: (text: string) => push('info', text),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-stack" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`toast toast-${m.tone}`}>
              {m.text}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
