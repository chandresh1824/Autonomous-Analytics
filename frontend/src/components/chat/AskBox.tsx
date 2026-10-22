import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/common/IconButton';
import { Spinner } from '@/components/common/Spinner';
import { useSpeechInput } from '@/hooks/useSpeechInput';

interface AskBoxProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** `hero` is the tall landing-page composer, `inline` the follow-up bar. */
  variant?: 'hero' | 'inline';
  autoFocus?: boolean;
  /** Shows the attachment control; omit to hide it. */
  onAttach?: () => void;
  hint?: string;
}

/**
 * The single question composer, used by both the Home hero and the chat
 * follow-up bar. Only its `variant` changes between the two, so the submit
 * behaviour, dictation and keyboard handling are written once.
 */
export function AskBox({
  onSend,
  disabled,
  placeholder = 'Ask a business question',
  variant = 'hero',
  autoFocus,
  onAttach,
  hint,
}: AskBoxProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const speech = useSpeechInput((transcript) => {
    setValue((prev) => (prev ? `${prev.trim()} ${transcript}` : transcript));
    textareaRef.current?.focus();
  });

  // Grow with the typed content instead of scrolling a one-line box.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = variant === 'hero' ? 220 : 160;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [value, variant]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const hasTools = Boolean(onAttach) || speech.supported;
  const canSend = !disabled && value.trim().length > 0;

  return (
    <div className={`ask-box ask-box-${variant}`}>
      <div className="ask-box-shell">
        <textarea
          ref={textareaRef}
          className="ask-box-textarea"
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={variant === 'hero' ? 3 : 1}
          aria-label={placeholder}
        />
        <div className="ask-box-actions">
          <div className="ask-box-tools">
            {hasTools && onAttach && (
              <IconButton icon="attach" label="Attach a file" size="sm" onClick={onAttach} disabled={disabled} />
            )}
            {speech.supported && (
              <IconButton
                icon="mic"
                label={speech.listening ? 'Stop dictation' : 'Dictate your question'}
                size="sm"
                active={speech.listening}
                onClick={speech.toggle}
                disabled={disabled}
              />
            )}
          </div>
          <button
            type="button"
            className="ask-box-send"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send question"
            title="Send question"
          >
            {disabled ? <Spinner size={16} /> : <SendGlyph />}
          </button>
        </div>
      </div>
      {hint && <p className="ask-box-hint">{hint}</p>}
    </div>
  );
}

/** Filled paper-plane, drawn inline because it is the only solid-fill glyph. */
function SendGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3.6 11.3 20.2 4.2c.7-.3 1.4.4 1.1 1.1l-7.1 16.6c-.3.7-1.3.7-1.5-.1l-1.9-6-6-1.9c-.8-.2-.8-1.2-.2-1.6Z" />
    </svg>
  );
}
