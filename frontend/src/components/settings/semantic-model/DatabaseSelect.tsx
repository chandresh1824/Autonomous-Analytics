import { KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ConnectionOut } from '@/types/api';
import { Icon } from '@/components/common/Icon';
import { useDismissable } from '@/hooks/useDismissable';

interface DatabaseSelectProps {
  connections: ConnectionOut[];
  value: string;
  onChange: (connectionId: string) => void;
}

/** Show a search box once the list is long enough to need one. */
const SEARCH_THRESHOLD = 6;

function ConnectionSummary({ connection }: { connection: ConnectionOut }) {
  return (
    <span className="sm-db-summary">
      <span className="sm-db-name-row">
        <span className="sm-db-name">{connection.name}</span>
        {connection.is_default && <span className="sm-db-tag sm-db-tag-default">Default</span>}
        {!connection.enabled && <span className="sm-db-tag sm-db-tag-muted">Disabled</span>}
      </span>
    </span>
  );
}

/**
 * Shows which database's semantic model is open, and switches between them
 * when there's more than one. A custom listbox (rather than a native
 * `<select>`) so the trigger and open menu can be fully styled; it keeps
 * the native keyboard model - arrows, Home/End, Enter, Escape, Tab. Only
 * the connection name is shown - never host or database details.
 */
export function DatabaseSelect({ connections, value, onChange }: DatabaseSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const current = connections.find((c) => c.id === value) ?? connections[0];
  const showSearch = connections.length >= SEARCH_THRESHOLD;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter((c) => c.name.toLowerCase().includes(q));
  }, [connections, query]);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(wrapRef, close, open);

  const openMenu = () => {
    setQuery('');
    setHighlighted(Math.max(0, connections.findIndex((c) => c.id === value)));
    setOpen(true);
  };

  // Focus the search box (or the list) when the menu opens.
  useEffect(() => {
    if (!open) return;
    (showSearch ? searchRef.current : listRef.current)?.focus();
  }, [open, showSearch]);

  // Keep the highlighted option scrolled into view inside the menu.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, highlighted]);

  const choose = (connection: ConnectionOut) => {
    setOpen(false);
    triggerRef.current?.focus();
    if (connection.id !== value) onChange(connection.id);
  };

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu();
    }
  };

  const handleMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = filtered.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlighted((i) => (i >= last ? 0 : i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlighted((i) => (i <= 0 ? last : i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setHighlighted(0);
        break;
      case 'End':
        e.preventDefault();
        setHighlighted(last);
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[highlighted]) choose(filtered[highlighted]);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  if (!current) return null;

  // With a single database there is nothing to switch to - show it as a
  // read-only chip in the same style.
  if (connections.length === 1) {
    return (
      <div className="sm-database">
        <span className="sm-database-label">Database</span>
        <div className="sm-db-trigger sm-db-trigger-static">
          <span className="sm-db-icon">
            <Icon name="database" size={16} />
          </span>
          <ConnectionSummary connection={current} />
        </div>
      </div>
    );
  }

  const activeOption = filtered[highlighted];

  return (
    <div className="sm-database">
      <span className="sm-database-label" id={`${listId}-label`}>
        Database
      </span>
      <div className="sm-db" ref={wrapRef}>
        <button
          ref={triggerRef}
          type="button"
          className={`sm-db-trigger ${open ? 'sm-db-trigger-open' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-labelledby={`${listId}-label ${listId}-value`}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={handleTriggerKeyDown}
        >
          <span className="sm-db-icon">
            <Icon name="database" size={16} />
          </span>
          <span id={`${listId}-value`} className="sm-db-summary-wrap">
            <ConnectionSummary connection={current} />
          </span>
          <span className="sm-db-chevron">
            <Icon name="chevron-down" size={16} />
          </span>
        </button>

        {open && (
          <div className="sm-db-menu" onKeyDown={handleMenuKeyDown}>
            <div className="sm-db-menu-header">
              <span>Switch database</span>
              <span className="sm-db-menu-count">{connections.length}</span>
            </div>

            {showSearch && (
              <label className="sm-db-search">
                <Icon name="search" size={15} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlighted(0);
                  }}
                  placeholder="Search databases…"
                  aria-label="Search databases"
                  aria-controls={listId}
                  aria-activedescendant={activeOption ? `${listId}-${activeOption.id}` : undefined}
                />
              </label>
            )}

            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-labelledby={`${listId}-label`}
              aria-activedescendant={activeOption ? `${listId}-${activeOption.id}` : undefined}
              className="sm-db-options"
            >
              {filtered.length === 0 && <li className="sm-db-empty">No databases match “{query}”.</li>}
              {filtered.map((c, index) => {
                const selected = c.id === value;
                return (
                  <li
                    key={c.id}
                    id={`${listId}-${c.id}`}
                    data-index={index}
                    role="option"
                    aria-selected={selected}
                    className={`sm-db-option ${index === highlighted ? 'sm-db-option-active' : ''} ${
                      selected ? 'sm-db-option-selected' : ''
                    }`}
                    onMouseEnter={() => setHighlighted(index)}
                    // mousedown, not click: keeps focus from leaving the menu first.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(c);
                    }}
                  >
                    <span className="sm-db-icon sm-db-icon-sm">
                      <Icon name="database" size={15} />
                    </span>
                    <ConnectionSummary connection={c} />
                    <span className="sm-db-check" aria-hidden="true">
                      {selected && <Icon name="check" size={16} strokeWidth={2.2} />}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
