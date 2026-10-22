import { useState } from 'react';

export interface AgentProgressStepView {
  key: string;
  label: string;
  status: 'pending' | 'active' | 'success' | 'error';
  detail?: string | null;
}

interface AgentProgressProps {
  steps: AgentProgressStepView[];
  /** True while still simulating -- keeps the panel expanded and un-collapsible. */
  live?: boolean;
}

export function AgentProgress({ steps, live = false }: AgentProgressProps) {
  const hasError = steps.some((s) => s.status === 'error');
  const [expanded, setExpanded] = useState(live || hasError);

  const doneCount = steps.filter((s) => s.status === 'success' || s.status === 'error').length;

  return (
    <div className={`agent-progress ${expanded ? 'agent-progress-expanded' : ''}`}>
      <button
        type="button"
        className="agent-progress-summary"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        {live ? (
          <span className="agent-progress-live-dot" aria-hidden="true" />
        ) : hasError ? (
          <StatusIcon status="error" />
        ) : (
          <StatusIcon status="success" />
        )}
        <span className="agent-progress-summary-text">
          {live
            ? steps.find((s) => s.status === 'active')?.label ?? 'Working…'
            : hasError
              ? 'Agent hit an issue'
              : `Agent steps (${doneCount}/${steps.length})`}
        </span>
        <span className="agent-progress-chevron">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <ul className="agent-progress-list">
          {steps.map((step) => (
            <li key={step.key} className={`agent-progress-item agent-progress-item-${step.status}`}>
              <StatusIcon status={step.status} />
              <div className="agent-progress-item-body">
                <span>{step.label}</span>
                {step.status === 'error' && step.detail && (
                  <p className="agent-progress-detail">{step.detail}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: AgentProgressStepView['status'] }) {
  if (status === 'success') {
    return (
      <span className="status-icon status-icon-success" aria-hidden="true">
        &#10003;
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="status-icon status-icon-error" aria-hidden="true">
        &#33;
      </span>
    );
  }
  if (status === 'active') {
    return <span className="status-icon status-icon-active" aria-hidden="true" />;
  }
  return <span className="status-icon status-icon-pending" aria-hidden="true" />;
}
