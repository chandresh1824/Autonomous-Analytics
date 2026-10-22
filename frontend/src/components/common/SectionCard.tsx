import { ReactNode } from 'react';

interface SectionCardProps {
  /** Small uppercase label above the hairline, e.g. "RESPONSE SUMMARY". */
  title: string;
  /** Optional control rendered on the title row (right aligned). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Labelled, bordered block used to structure an answer card (Response
 * Summary / Key Drivers / Visualization / Data) and any other panel that
 * needs the same framing.
 */
export function SectionCard({ title, action, children, className }: SectionCardProps) {
  return (
    <section className={['section-card', className].filter(Boolean).join(' ')}>
      <header className="section-card-head">
        <h4 className="section-card-title">{title}</h4>
        {action}
      </header>
      <div className="section-card-body">{children}</div>
    </section>
  );
}
