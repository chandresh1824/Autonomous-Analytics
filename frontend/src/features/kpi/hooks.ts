import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/services/apiClient';
import type { KPI } from '@/types/api';

// KPIs live in each datasource's own semantic model on the backend, so every
// query/mutation is scoped by connectionId (falling back to a fixed 'default'
// segment when none is selected, matching the backend's default-connection
// fallback) - that keeps each database's KPI cache separate.
const KPIS_KEY = ['kpis'] as const;
const MODEL_KEY = ['semantic-model'] as const;
const kpisKey = (connectionId?: string) => [...KPIS_KEY, connectionId ?? 'default'] as const;

function withConnectionParam(path: string, connectionId?: string): string {
  return connectionId ? `${path}?connection_id=${encodeURIComponent(connectionId)}` : path;
}

// KPI edits are saved as a draft of the semantic model, so the model/version
// caches (which drive the Publish button and "unpublished changes" banner)
// are refreshed alongside the KPI list.
function useInvalidateKpis() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: KPIS_KEY });
    queryClient.invalidateQueries({ queryKey: MODEL_KEY });
  };
}

export function useKpis(connectionId?: string) {
  return useQuery({
    queryKey: kpisKey(connectionId),
    queryFn: async () => {
      const { data } = await apiClient.get<KPI[]>(withConnectionParam('/api/kpis', connectionId));
      return data;
    },
    retry: false,
  });
}

export function useCreateKpi(connectionId?: string) {
  const invalidate = useInvalidateKpis();
  return useMutation({
    mutationFn: async (payload: KPI) => {
      const { data } = await apiClient.post<KPI>(withConnectionParam('/api/kpis', connectionId), payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateKpi(connectionId?: string) {
  const invalidate = useInvalidateKpis();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: KPI }) => {
      const { data } = await apiClient.put<KPI>(
        withConnectionParam(`/api/kpis/${encodeURIComponent(id)}`, connectionId),
        payload,
      );
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteKpi(connectionId?: string) {
  const invalidate = useInvalidateKpis();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(withConnectionParam(`/api/kpis/${encodeURIComponent(id)}`, connectionId));
    },
    onSuccess: invalidate,
  });
}

export function useEnableKpi(connectionId?: string) {
  const invalidate = useInvalidateKpis();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<KPI>(
        withConnectionParam(`/api/kpis/${encodeURIComponent(id)}/enable`, connectionId),
      );
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDisableKpi(connectionId?: string) {
  const invalidate = useInvalidateKpis();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<KPI>(
        withConnectionParam(`/api/kpis/${encodeURIComponent(id)}/disable`, connectionId),
      );
      return data;
    },
    onSuccess: invalidate,
  });
}


// Publishing and discarding drafts happen once for the whole semantic model
// (see `DraftActions` in components/settings/semantic-model/draft) - KPIs
// version together with entities, dimensions, measures, and metrics.
