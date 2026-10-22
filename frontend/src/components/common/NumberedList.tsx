import { ReactNode } from 'react';

interface NumberedListProps {
  items: ReactNode[];
}

/** Ordered list rendered with the brand's numbered circle markers. */
export function NumberedList({ items }: NumberedListProps) {
  return (
    <ol className="numbered-list">
      {items.map((item, idx) => (
        <li className="numbered-list-item" key={idx}>
          <span className="numbered-list-marker" aria-hidden="true">
            {idx + 1}
          </span>
          <span className="numbered-list-text">{item}</span>
        </li>
      ))}
    </ol>
  );
}
