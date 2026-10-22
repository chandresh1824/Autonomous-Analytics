import { useRef, useState } from 'react';
import type { DisplayMessage } from '@/features/chat/types';
import { AGENT_PROGRESS_STEPS, type AgentProgressStep, type ChatResponse } from '@/types/api';
import { AgentProgress, AgentProgressStepView } from './AgentProgress';
import { ChartRenderer } from '@/components/charts/ChartRenderer';
import { DataTable } from '@/components/tables/DataTable';
import { EmphasizedFigures } from './EmphasizedFigures';
import { formatDuration } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { NumberedList } from '@/components/common/NumberedList';
import { SectionCard } from '@/components/common/SectionCard';
import { StatusPill } from '@/components/common/StatusPill';
import { useIsPinned, usePinWidget } from '@/features/dashboard/hooks';
import { useToast } from '@/components/common/Toast';
import { getApiErrorMessage } from '@/services/apiClient';

interface MessageBubbleProps {
  message: DisplayMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <div className="message-row message-row-user">
        <div className="message-bubble message-bubble-user">{message.userText}</div>
      </div>
    );
  }

  if (message.pending) {
    return (
      <div className="message-row message-row-assistant">
        <article className="answer-card">
          <header className="answer-card-head">
            <StatusPill tone="info" label="Working on it" icon="chat" />
          </header>
          <LiveProgress steps={message.liveProgress ?? []} />
        </article>
      </div>
    );
  }

  const response = message.response;
  if (!response) return null;

  return (
    <div className="message-row message-row-assistant">
      <AnswerCard response={response} question={message.question ?? ''} />
    </div>
  );
}

/**
 * One answered question, presented as a status pill (with how long the answer
 * took) plus the same labelled sections every time: Summary, Key highlights,
 * Data and Charts.
 */
function AnswerCard({ response, question }: { response: ChatResponse; question: string }) {
  const isError = response.status === 'error';

  const summary =
    response.summary ||
    (isError
      ? response.errors[0] || 'The agent could not complete this request.'
      : 'No summary was returned for this question.');

  // On a failure the backend reports reasons in `errors`; those stand in for
  // the insights a successful answer would carry.
  const drivers = response.insights.length > 0 ? response.insights : isError ? response.errors : [];
  /* A query can succeed and still match nothing. Without this check the card
     renders an empty Visualization frame and an empty Data table under a
     summary that already says there were no results. */
  const rowCount = response.table?.rows.length ?? 0;
  const hasChart = Boolean(
    response.visualization && response.visualization.type !== 'table' && response.table && rowCount > 0,
  );
  const totalMs = response.metadata.total_time_ms ?? 0;

  return (
    <article className={`answer-card ${isError ? 'answer-card-error' : ''}`}>
      <header className="answer-card-head">
        <StatusPill
          tone={isError ? 'danger' : 'success'}
          label={isError ? 'Execution failed' : 'Answered'}
        />
        {totalMs > 0 && (
          <span className="answer-time" title="Time from asking the question to this answer">
            <Icon name="clock" size={13} />
            {isError ? 'Stopped after' : 'Answered in'} {formatDuration(totalMs)}
          </span>
        )}
        <div className="answer-card-head-actions">
          <PinButton question={question} response={response} />
        </div>
      </header>

      {/* One section: the direct answer, then the points that add detail to it. */}
      <SectionCard title="Summary">
        <p className="answer-summary">{isError ? summary : <EmphasizedFigures text={summary} />}</p>
        {drivers.length > 0 && (
          <div className="answer-points">
            <NumberedList items={isError ? drivers : drivers.map((d) => <EmphasizedFigures text={d} />)} />
          </div>
        )}
      </SectionCard>

      {response.table && rowCount > 0 && (
        <SectionCard title="Data">
          <DataTable columns={response.table.columns} rows={response.table.rows} />
        </SectionCard>
      )}

      {(hasChart || isError) && (
        <SectionCard title="Charts">
          {hasChart ? (
            <ChartRenderer visualization={response.visualization!} table={response.table!} />
          ) : (
            <p className="answer-placeholder">No chart is available for this response.</p>
          )}
        </SectionCard>
      )}
    </article>
  );
}

/** Renders the real agent progress as it streams in over SSE - `steps` holds
 * only the AgentStatus events received so far, so any step in
 * AGENT_PROGRESS_STEPS beyond the last received one is still "pending",
 * and the one right after it is "active" (currently running on the
 * backend). */
function LiveProgress({ steps }: { steps: AgentProgressStep[] }) {
  const receivedByStep = new Map(steps.map((s) => [s.step, s]));
  const lastReceivedIndex = AGENT_PROGRESS_STEPS.reduce(
    (last, s, idx) => (receivedByStep.has(s.step) ? idx : last),
    -1,
  );
  const view: AgentProgressStepView[] = AGENT_PROGRESS_STEPS.map((s, idx) => {
    const received = receivedByStep.get(s.step);
    if (received) {
      return { key: s.step, label: s.label, status: received.status, detail: received.detail };
    }
    return { key: s.step, label: s.label, status: idx === lastReceivedIndex + 1 ? 'active' : 'pending' };
  });
  return <AgentProgress steps={view} live />;
}

/**
 * Saves a point-in-time snapshot of this response as a widget on the
 * Dashboard (see `usePinWidget`) - not a live query, so the widget renders
 * instantly and never changes once pinned.
 *
 * "Already pinned" is derived from the Dashboard's own widget list via
 * `useIsPinned`, not from local state, so asking the same question again,
 * reloading the page or opening a second tab cannot produce duplicate tiles.
 * To pin a fresher answer for a question, remove its widget from the
 * Dashboard first.
 */
function PinButton({ question, response }: { question: string; response: ChatResponse }) {
  const pinWidget = usePinWidget();
  const toast = useToast();
  const [justPinned, setJustPinned] = useState(false);
  const alreadyPinned = useIsPinned(question, response.message_id);
  const pinned = justPinned || alreadyPinned;
  /* Set synchronously on the first click. A `pinned`/`isPending` check alone
     cannot stop a rapid double-click: both only take effect on the next
     render, so every click in the same tick would still POST a widget. */
  const submittedRef = useRef(false);

  const hasContent = Boolean(response.summary || response.table || response.visualization);
  if (!hasContent) return null;

  /* A failed run produces no result to keep, so the control is shown in the
     same dimmed style as an already-pinned one, with the reason on hover. It
     is not given the native `disabled` attribute: Chrome suppresses both the
     tooltip and the click on a disabled button, which would leave the reason
     unreachable. */
  const blockedReason =
    response.status === 'error' ? 'This answer failed, so there is no result to pin.' : null;
  const inactive = pinned || blockedReason !== null;

  const handlePin = () => {
    // The control stays clickable when inactive (it reads as a dimmed state
    // rather than a dead button), so the guards live here.
    if (blockedReason) {
      toast.info(blockedReason);
      return;
    }
    if (pinned) {
      toast.info('This question is already on the Dashboard.');
      return;
    }
    if (submittedRef.current) return;
    submittedRef.current = true;
    pinWidget.mutate(
      {
        title: question,
        question,
        conversation_id: response.conversation_id || null,
        message_id: response.message_id || null,
        summary: response.summary,
        insights: response.insights,
        visualization: response.visualization,
        table: response.table,
        metadata: response.metadata,
        sql: response.sql,
      },
      {
        onSuccess: () => {
          setJustPinned(true);
          toast.success('Pinned to Dashboard');
        },
        onError: (error) => {
          // Let the user retry after a failed pin.
          submittedRef.current = false;
          toast.error(getApiErrorMessage(error, 'Could not pin this question.'));
        },
      },
    );
  };

  return (
    <button
      type="button"
      className={`pin-btn ${inactive ? 'pin-btn-inactive' : ''}`}
      onClick={handlePin}
      disabled={pinWidget.isPending}
      aria-pressed={pinned}
      aria-disabled={blockedReason !== null}
      title={
        blockedReason ??
        (pinned
          ? 'Already on the Dashboard — remove it there to pin a newer answer'
          : 'Pin to Dashboard')
      }
    >
      <Icon name="pin" size={14} />
      <span>{pinned ? 'Pinned' : 'Pin'}</span>
    </button>
  );
}
