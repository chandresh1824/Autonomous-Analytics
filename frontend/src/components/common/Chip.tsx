import { ReactNode } from 'react';

interface ChipProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}

/** Soft pill used for the suggested questions on Home. */
export function Chip({ children, onClick, disabled, title }: ChipProps) {
  return (
    <button type="button" className="chip" onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function ChipGroup({ children }: { children: ReactNode }) {
  return <div className="chip-group">{children}</div>;
}
