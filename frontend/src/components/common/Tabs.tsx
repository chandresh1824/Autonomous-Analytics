import { ReactNode } from 'react';

export interface TabItem {
  key: string;
  label: string;
  badge?: number;
}

interface TabsProps {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  orientation?: 'horizontal' | 'vertical';
  trailing?: ReactNode;
}

export function Tabs({ items, activeKey, onChange, orientation = 'horizontal', trailing }: TabsProps) {
  return (
    <div className={`tabs tabs-${orientation}`} role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          aria-selected={item.key === activeKey}
          className={`tab-btn ${item.key === activeKey ? 'tab-btn-active' : ''}`}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {typeof item.badge === 'number' && item.badge > 0 && (
            <span className="tab-badge">{item.badge}</span>
          )}
        </button>
      ))}
      {trailing}
    </div>
  );
}
