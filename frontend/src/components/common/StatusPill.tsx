import { Icon, IconName } from './Icon';

export type StatusTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

interface StatusPillProps {
  tone: StatusTone;
  label: string;
  icon?: IconName;
}

const DEFAULT_ICON: Record<StatusTone, IconName | undefined> = {
  success: 'check',
  danger: 'alert',
  warning: 'alert',
  info: 'info',
  neutral: undefined,
};

/** Uppercase state chip shown at the top of an answer card. */
export function StatusPill({ tone, label, icon }: StatusPillProps) {
  const glyph = icon ?? DEFAULT_ICON[tone];
  return (
    <span className={`status-pill status-pill-${tone}`}>
      {glyph && <Icon name={glyph} size={14} strokeWidth={2} />}
      <span>{label}</span>
    </span>
  );
}
