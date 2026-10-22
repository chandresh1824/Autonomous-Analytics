interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 18, className }: SpinnerProps) {
  return (
    <span
      className={['spinner', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}
