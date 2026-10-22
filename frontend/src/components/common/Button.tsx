import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, disabled, className, children, ...rest }, ref) => {
    const classes = ['btn', `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(' ');
    return (
      <button ref={ref} className={classes} disabled={disabled || loading} {...rest}>
        {loading && <Spinner size={14} />}
        <span>{children}</span>
      </button>
    );
  },
);
Button.displayName = 'Button';
