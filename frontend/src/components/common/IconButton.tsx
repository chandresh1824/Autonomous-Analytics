import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Icon, IconName } from './Icon';
import { Spinner } from './Spinner';

type IconButtonVariant = 'ghost' | 'outline' | 'soft' | 'solid';
type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required: an icon-only control has no visible text to name it. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Circular by default; set false for a rounded square. */
  round?: boolean;
  active?: boolean;
  /** Shows a spinner in place of the icon and disables the button. */
  loading?: boolean;
  /** 'danger' colours a destructive action (delete/remove) red. */
  tone?: 'default' | 'danger';
}

const ICON_SIZE: Record<IconButtonSize, number> = { xs: 15, sm: 15, md: 18, lg: 20 };

/**
 * The one icon-only control used across the app — composer actions, card
 * headers, panel toggles. Visual weight is chosen with `variant`, so callers
 * never restyle a bare `<button>`.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      label,
      variant = 'outline',
      size = 'md',
      round = true,
      active,
      loading = false,
      tone = 'default',
      disabled,
      className,
      ...rest
    },
    ref,
  ) => {
    const classes = [
      'icon-btn',
      `icon-btn-${variant}`,
      `icon-btn-${size}`,
      round ? 'icon-btn-round' : '',
      active ? 'icon-btn-active' : '',
      tone === 'danger' ? 'icon-btn-danger' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        type="button"
        className={classes}
        aria-label={label}
        title={label}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? <Spinner size={ICON_SIZE[size] - 1} /> : <Icon name={icon} size={ICON_SIZE[size]} />}
      </button>
    );
  },
);
IconButton.displayName = 'IconButton';
