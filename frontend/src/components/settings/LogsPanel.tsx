import { useState } from 'react';
import { useLogs } from '@/features/logs/hooks';
import type { LogEntry } from '@/types/api';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { EmptyState } from '@/components/common/EmptyState';

const LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];

const LEVEL_TONE: Record<string, 'neutral' | 'success' | 'danger' | 'warning' | 'accent'> = {
  DEBUG: 'neutral',
  INFO: 'accent',
  WARNING: 'warning',
  ERROR: 'danger',
  CRITICAL: 'danger',
};

export function LogsPanel() {
  const [level, setLevel] = useState('');
  const [query, setQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const logsQuery = useLogs({ level: level || undefined, q: query || undefined, limit: 500 }, autoRefresh ? 5000 : false);

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <div>
          <h2>Logs</h2>
          <p className="settings-panel-subtitle">
            Recent backend log entries, most recent first - useful for seeing the real error behind a failed
            chat request or semantic model generation.
          </p>
        </div>
        <div className="settings-panel-header-actions settings-panel-header-actions-wrap">
          <label className="log-toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh
          </label>
          <Button variant="secondary" size="sm" loading={logsQuery.isFetching} onClick={() => logsQuery.refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="log-filters">
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All levels</option>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}+
            </option>
          ))}
        </select>
        <input
          className="search-input"
          placeholder="Search message, request id, conversation id…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {logsQuery.isLoading ? (
        <div className="settings-loading">
          <Spinner size={20} />
        </div>
      ) : (logsQuery.data ?? []).length === 0 ? (
        <EmptyState title="No log entries" description="Nothing matches these filters yet." />
      ) : (
        <ul className="log-list">
          {(logsQuery.data ?? []).map((entry, idx) => (
            <LogRow key={`${entry.timestamp}-${idx}`} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);
  const { timestamp, level, logger, message, request_id, conversation_id, exception, ...rest } = entry;
  const extra = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'level' && k !== 'logger'));

  return (
    <li className="log-entry">
      <button type="button" className="log-entry-header" onClick={() => setOpen((o) => !o)}>
        <Badge tone={LEVEL_TONE[level] ?? 'neutral'}>{level}</Badge>
        <span className="log-entry-time">{timestamp}</span>
        <span className="log-entry-logger mono-cell">{logger}</span>
        <span className="log-entry-message">{message}</span>
      </button>
      {open && (
        <div className="log-entry-detail">
          <div className="log-entry-detail-row">
            <span>request_id</span>
            <span className="mono-cell">{request_id}</span>
          </div>
          <div className="log-entry-detail-row">
            <span>conversation_id</span>
            <span className="mono-cell">{conversation_id}</span>
          </div>
          {exception && <pre className="json-preview-block">{exception}</pre>}
          {Object.keys(extra).length > 0 && (
            <pre className="json-preview-block">{JSON.stringify(extra, null, 2)}</pre>
          )}
        </div>
      )}
    </li>
  );
}
