import { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'accent';

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
