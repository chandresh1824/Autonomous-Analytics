import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/common/Badge';
import { Icon } from '@/components/common/Icon';
import { PageHeader } from '@/components/layout/PageHeader';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { useToast } from '@/components/common/Toast';
import { ChartRenderer } from '@/components/charts/ChartRenderer';
import { DataTable } from '@/components/tables/DataTable';
import { useDashboardWidgets, useUnpinWidget, useWidgetOrder } from '@/features/dashboard/hooks';
import { getApiErrorMessage } from '@/services/apiClient';
import type { PinnedWidget } from '@/types/api';
import { formatDateTime, formatMs } from '@/utils/format';
import { HomePage } from './HomePage';

export function DashboardPage() {
  const widgetsQuery = useDashboardWidgets();
  const widgets = widgetsQuery.data ?? [];
  const { ordered, saveOrder } = useWidgetOrder(widgets);
  // Order shown while a drag is in progress; committed via saveOrder on drop.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const byId = new Map(ordered.map((w) => [w.id, w]));
  const displayed = dragOrder
    ? dragOrder.map((id) => byId.get(id)).filter((w): w is PinnedWidget => Boolean(w))
    : ordered;

  /* Slide cards to their new slots when the order changes (FLIP): measure
     where each card was, let React move it, then animate from the old spot.
     Without this, cards jump instantly and the drop position is hard to see. */
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const lastRects = useRef(new Map<string, DOMRect>());
  const orderKey = displayed.map((w) => w.id).join('|');
  useLayoutEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nextRects = new Map<string, DOMRect>();
    cardEls.current.forEach((el, id) => {
      const rect = el.getBoundingClientRect();
      nextRects.set(id, rect);
      const prev = lastRects.current.get(id);
      if (!prev || reduceMotion) return;
      const dx = prev.left - rect.left;
      const dy = prev.top - rect.top;
      if (!dx && !dy) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 220ms cubic-bezier(0.2, 0, 0, 1)';
        el.style.transform = '';
        // Hand transitions back to the stylesheet (hover lift etc.).
        el.addEventListener('transitionend', () => (el.style.transition = ''), { once: true });
      });
    });
    lastRects.current = nextRects;
  }, [orderKey]);

  const handleDragStart = (id: string) => {
    setDraggingId(id);
    setDragOrder(ordered.map((w) => w.id));
  };

  const handleDragEnter = (targetId: string) => {
    if (!draggingId || targetId === draggingId) return;
    setDragOrder((prev) => {
      if (!prev) return prev;
      const fromIdx = prev.indexOf(draggingId);
      const toIdx = prev.indexOf(targetId);
      const next = prev.filter((id) => id !== draggingId);
      // Removing the dragged id shifts later items left by one, so inserting
      // at toIdx lands after the target when moving forward, before it when
      // moving backward.
      next.splice(toIdx, 0, draggingId);
      return fromIdx === toIdx ? prev : next;
    });
  };

  const handleDragEnd = () => {
    if (dragOrder) saveOrder(dragOrder);
    setDragOrder(null);
    setDraggingId(null);
  };

  /** Keyboard reordering from the drag handle (arrow keys move one slot). */
  const moveBy = (id: string, delta: number) => {
    const ids = ordered.map((w) => w.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    saveOrder(ids);
  };

  // Nothing pinned yet: the root shows the Ask screen in place, with no
  // redirect, so the URL stays "/".
  if (widgetsQuery.isSuccess && widgets.length === 0) {
    return <HomePage />;
  }

  return (
    <div className="dashboard-page">
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <Link to="/ask" className="btn btn-primary btn-md">
              <Icon name="sparkle" size={16} />
              <span>Ask</span>
            </Link>
          </>
        }
      />

      {widgetsQuery.isLoading ? (
        <div className="dashboard-loading">
          <Spinner size={22} />
        </div>
      ) : widgets.length === 0 ? (
        <div className="dashboard-empty">
          <EmptyState
            title="Nothing pinned yet"
            description='Ask a question in Chat, then use the "Pin" button on its answer to add it here.'
          />
        </div>
      ) : (
        <div className="dashboard-grid">
          {displayed.map((widget) => (
            <WidgetCard
              key={widget.id}
              widget={widget}
              cardRef={(el) => {
                if (el) cardEls.current.set(widget.id, el);
                else cardEls.current.delete(widget.id);
              }}
              dragging={draggingId === widget.id}
              onDragStart={() => handleDragStart(widget.id)}
              onDragEnter={() => handleDragEnter(widget.id)}
              onDragEnd={handleDragEnd}
              onMove={(delta) => moveBy(widget.id, delta)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface WidgetCardProps {
  widget: PinnedWidget;
  cardRef: (el: HTMLDivElement | null) => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onMove: (delta: number) => void;
}

function WidgetCard({ widget, cardRef, dragging, onDragStart, onDragEnter, onDragEnd, onMove }: WidgetCardProps) {
  const unpinWidget = useUnpinWidget();
  const toast = useToast();
  const [removing, setRemoving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Drags may only start from the grip, so text selection and chart/table
  // interactions inside the card keep working normally.
  const fromHandle = useRef(false);

  const handleUnpin = () => {
    setRemoving(true);
    unpinWidget.mutate(widget.id, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast.info('Removed from Dashboard');
      },
      onError: (error) => {
        setRemoving(false);
        setConfirmOpen(false);
        toast.error(getApiErrorMessage(error, 'Could not remove this widget.'));
      },
    });
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (!fromHandle.current) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', widget.id);
    // Use the whole card as the drag preview, held where the grip was grabbed.
    const rect = event.currentTarget.getBoundingClientRect();
    event.dataTransfer.setDragImage(event.currentTarget, event.clientX - rect.left, event.clientY - rect.top);
    // The browser snapshots the preview after this handler returns; marking
    // the card as the drop slot first would make the preview the faded slot.
    setTimeout(onDragStart, 0);
  };

  const handleDragEnd = () => {
    fromHandle.current = false;
    onDragEnd();
  };

  const handleGripKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      onMove(-1);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      onMove(1);
    }
  };

  const classes = ['dashboard-widget-card'];
  if (removing) classes.push('dashboard-widget-card-removing');
  if (dragging) classes.push('dashboard-widget-card-dragging');

  return (
    <div
      ref={cardRef}
      className={classes.join(' ')}
      draggable
      onDragStart={handleDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => event.preventDefault()}
      onDragEnd={handleDragEnd}
    >
      <div className="dashboard-widget-accent" />
      <div className="dashboard-widget-header">
        <div className="dashboard-widget-heading">
          <button
            type="button"
            className="dashboard-widget-handle"
            onMouseDown={() => (fromHandle.current = true)}
            onMouseUp={() => (fromHandle.current = false)}
            onKeyDown={handleGripKeyDown}
            aria-label="Reorder widget (drag, or use arrow keys)"
            title="Drag to reorder"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="9" cy="6" r="1.6" />
              <circle cx="15" cy="6" r="1.6" />
              <circle cx="9" cy="12" r="1.6" />
              <circle cx="15" cy="12" r="1.6" />
              <circle cx="9" cy="18" r="1.6" />
              <circle cx="15" cy="18" r="1.6" />
            </svg>
          </button>
          <WidgetTypeIcon type={widget.visualization?.type} />
          <h3 className="dashboard-widget-title" title={widget.question}>
            {widget.title || widget.question}
          </h3>
        </div>
        <button
          type="button"
          className="dashboard-widget-remove"
          onClick={() => setConfirmOpen(true)}
          disabled={removing}
          aria-label="Remove from dashboard"
          title="Remove from dashboard"
        >
          &times;
        </button>
      </div>

      <div className="dashboard-widget-body">
        <p className="dashboard-widget-date">{formatDateTime(widget.created_at)}</p>

        {widget.summary && <p className="dashboard-widget-summary">{widget.summary}</p>}

        {widget.visualization && widget.table && (
          <ChartRenderer visualization={widget.visualization} table={widget.table} />
        )}

        {widget.table && (
          <div className="dashboard-widget-table">
            <DataTable columns={widget.table.columns} rows={widget.table.rows} pageSize={5} />
          </div>
        )}

        {widget.insights.length > 0 && (
          <ul className="message-insights">
            {widget.insights.map((insight, idx) => (
              <li key={idx}>{insight}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="dashboard-widget-footer">
        <div className="message-meta-row">
          {widget.metadata.row_count > 0 && <Badge tone="neutral">{widget.metadata.row_count} rows</Badge>}
          {widget.metadata.execution_time_ms > 0 && (
            <Badge tone="neutral">{formatMs(widget.metadata.execution_time_ms)}</Badge>
          )}
          {widget.metadata.kpis.map((kpi) => (
            <Badge tone="accent" key={kpi}>
              {kpi}
            </Badge>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Remove widget?"
        message={`"${widget.title || widget.question}" will be removed from your Dashboard. You can pin it again from Chat.`}
        confirmLabel="Remove"
        danger
        busy={removing}
        onConfirm={handleUnpin}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

const TYPE_ICON_PATHS: Record<string, string> = {
  line: 'M3 17 9 10 13 14 21 5',
  area: 'M3 17 9 10 13 14 21 5',
  bar: 'M5 20V10 M11 20V4 M17 20V13',
  grouped_bar: 'M5 20V10 M11 20V4 M17 20V13',
  stacked_bar: 'M5 20V10 M11 20V4 M17 20V13',
  horizontal_bar: 'M4 5h10 M4 12h16 M4 19h7',
  stacked_area: 'M3 17 9 10 13 14 21 5',
  combo: 'M5 20V12 M11 20V8 M17 20V14 M3 10 11 5 21 9',
  scatter: 'M6 16h.01 M10 9h.01 M15 13h.01 M18 6h.01',
  radar: 'M12 3 21 10 17 20H7L3 10Z',
  radial_bar: 'M12 3a9 9 0 1 0 9 9',
  funnel: 'M3 5h18l-7 8v6l-4 2v-8Z',
  treemap: 'M4 4h16v16H4z M12 4v16 M12 12h8',
  multi_chart: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h16v7H4z',
  pie: 'M12 3a9 9 0 1 0 9 9h-9Z',
  donut: 'M12 3a9 9 0 1 0 9 9h-9Z',
  heatmap: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  kpi_card: 'M4 12h4l2-6 4 12 2-6h4',
  table: 'M4 5h16v14H4zM4 10h16M9 5v14',
};

function WidgetTypeIcon({ type }: { type?: string | null }) {
  const path = (type && TYPE_ICON_PATHS[type]) || TYPE_ICON_PATHS.table;
  return (
    <span className="dashboard-widget-icon" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <path d={path} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
