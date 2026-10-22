import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/services/apiClient';
import type { PinnedWidget, PinnedWidgetCreate } from '@/types/api';

const WIDGETS_KEY = ['dashboard-widgets'] as const;

export function useDashboardWidgets() {
  return useQuery({
    queryKey: WIDGETS_KEY,
    queryFn: async () => {
      const { data } = await apiClient.get<PinnedWidget[]>('/api/dashboard/widgets');
      return data;
    },
  });
}

export function usePinWidget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: PinnedWidgetCreate) => {
      const { data } = await apiClient.post<PinnedWidget>('/api/dashboard/widgets', payload);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WIDGETS_KEY }),
  });
}

/** Case- and whitespace-insensitive form used to compare two questions. */
function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * True when this answer is already on the Dashboard.
 *
 * Checked against the server's widget list rather than local component state,
 * so the Pin control stays disabled after a reload, after the same question is
 * asked again in a new message, and in a second browser tab - all cases that
 * previously produced duplicate tiles. A widget matches on its message id
 * (the very same answer) or on the question text (the same question pinned
 * again from a later answer).
 */
export function useIsPinned(question: string, messageId?: string | null): boolean {
  const { data } = useDashboardWidgets();
  return useMemo(() => {
    const widgets = data ?? [];
    const normalized = normalizeQuestion(question);
    return widgets.some((widget) => {
      if (messageId && widget.message_id && widget.message_id === messageId) return true;
      return normalized.length > 0 && normalizeQuestion(widget.question) === normalized;
    });
  }, [data, question, messageId]);
}

export function useUnpinWidget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/api/dashboard/widgets/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WIDGETS_KEY }),
  });
}

/**
 * The user's drag-and-drop arrangement of Dashboard widgets. The server
 * returns widgets in the user's saved order (newly pinned ones first), so
 * `ordered` is just that list; `saveOrder` applies a new order right away
 * and saves it to the user's account, so it follows them across browsers.
 */
export function useWidgetOrder(widgets: PinnedWidget[]) {
  const queryClient = useQueryClient();
  const persist = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiClient.put('/api/dashboard/widgets/order', { ids });
    },
    // On failure, reload the saved order rather than keep one that wasn't stored.
    onError: () => queryClient.invalidateQueries({ queryKey: WIDGETS_KEY }),
  });

  const saveOrder = useCallback(
    (ids: string[]) => {
      queryClient.setQueryData<PinnedWidget[]>(WIDGETS_KEY, (current) => {
        if (!current) return current;
        const byId = new Map(current.map((w) => [w.id, w]));
        const reordered = ids.map((id) => byId.get(id)).filter((w): w is PinnedWidget => Boolean(w));
        const rest = current.filter((w) => !ids.includes(w.id));
        return [...reordered, ...rest];
      });
      persist.mutate(ids);
    },
    [queryClient, persist],
  );

  return { ordered: widgets, saveOrder };
}
