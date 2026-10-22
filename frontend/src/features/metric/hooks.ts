import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/services/apiClient';
import type { Metric } from '@/types/api';

const METRICS_KEY = ['metrics'] as const;
const MODEL_KEY = ['semantic-model'] as const;

// Metrics are scoped per datasource on the backend; connectionId is optional
// so callers without a database picker keep using the default connection.
function withConnectionParam(path: string, connectionId?: string): string {
  return connectionId ? `${path}?connection_id=${encodeURIComponent(connectionId)}` : path;
}

/** `enabled` (default true) lets a caller working on an unsaved, in-memory
 * model skip the fetch entirely. */
export function useMetrics(connectionId?: string, enabled = true) {
  return useQuery({
    queryKey: [...METRICS_KEY, connectionId ?? 'default'],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<Metric[]>(withConnectionParam('/api/metrics', connectionId));
      return data;
    },
    retry: false,
  });
}

export function useCreateMetric(connectionId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Metric) => {
      const { data } = await apiClient.post<Metric>(withConnectionParam('/api/metrics', connectionId), payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: METRICS_KEY });
      queryClient.invalidateQueries({ queryKey: MODEL_KEY });
    },
  });
}

export function useUpdateMetric(connectionId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Metric }) => {
      const { data } = await apiClient.put<Metric>(
        withConnectionParam(`/api/metrics/${encodeURIComponent(id)}`, connectionId),
        payload,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: METRICS_KEY });
      queryClient.invalidateQueries({ queryKey: MODEL_KEY });
    },
  });
}

export function useDeleteMetric(connectionId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(withConnectionParam(`/api/metrics/${encodeURIComponent(id)}`, connectionId));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: METRICS_KEY });
      queryClient.invalidateQueries({ queryKey: MODEL_KEY });
    },
  });
}
