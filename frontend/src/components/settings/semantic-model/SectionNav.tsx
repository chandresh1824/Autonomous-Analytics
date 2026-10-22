import { KeyboardEvent, useRef } from 'react';
import { Icon } from '@/components/common/Icon';
import {
  ALL_SECTIONS,
  SECTION_GROUPS,
  type SectionStats,
  type SemanticModelSectionKey,
} from './sections';

interface SectionNavProps {
  active: SemanticModelSectionKey;
  onChange: (key: SemanticModelSectionKey) => void;
  stats: Record<SemanticModelSectionKey, SectionStats>;
}

/**
 * Grouped navigator for the semantic model's sections. Each item shows its
 * item count and a marker when it has unpublished draft changes. Behaves as
 * an ARIA tablist: arrow keys / Home / End move between sections.
 */
export function SectionNav({ active, onChange, stats }: SectionNavProps) {
  const buttons = useRef(new Map<SemanticModelSectionKey, HTMLButtonElement>());

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = ALL_SECTIONS.findIndex((s) => s.key === active);
    const last = ALL_SECTIONS.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? index === last ? 0 : index + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? index === 0 ? last : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    const key = ALL_SECTIONS[next].key;
    onChange(key);
    buttons.current.get(key)?.focus();
  };

  return (
    <div className="sm-nav" role="tablist" aria-label="Semantic model sections" onKeyDown={handleKeyDown}>
      {SECTION_GROUPS.map((group) => (
        <div className="sm-nav-group" key={group.label} role="presentation" data-tone={group.tone}>
          <span className="sm-nav-group-label">
            <span className="sm-tone-dot" aria-hidden="true" />
            {group.label}
          </span>
          <div className="sm-nav-items" role="presentation">
            {group.sections.map((section) => {
              const isActive = section.key === active;
              const { count, changes } = stats[section.key];
              return (
                <button
                  key={section.key}
                  ref={(el) => {
                    if (el) buttons.current.set(section.key, el);
                    else buttons.current.delete(section.key);
                  }}
                  type="button"
                  role="tab"
                  id={`sm-tab-${section.key}`}
                  aria-selected={isActive}
                  aria-controls="sm-section-panel"
                  tabIndex={isActive ? 0 : -1}
                  className={`sm-nav-item ${isActive ? 'sm-nav-item-active' : ''}`}
                  onClick={() => onChange(section.key)}
                  title={changes ? `${changes} unpublished change${changes === 1 ? '' : 's'}` : undefined}
                >
                  <span className="sm-nav-icon">
                    <Icon name={section.icon} size={16} />
                    {changes > 0 && <span className="sm-nav-dot" aria-hidden="true" />}
                  </span>
                  <span className="sm-nav-label">{section.label}</span>
                  {count !== undefined && <span className="sm-nav-count">{count}</span>}
                  {changes > 0 && <span className="visually-hidden">, has unpublished changes</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
