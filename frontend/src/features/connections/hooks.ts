import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/services/apiClient';
import type {
  ConnectionCreate,
  ConnectionOut,
  ConnectionTestPayload,
  ConnectionTestResult,
  ConnectionUpdate,
} from '@/types/api';

const CONNECTIONS_KEY = ['connections'] as const;

// Mutations that carry a password drop out of the mutation cache as soon as
// nothing observes them, so the plaintext never lingers in browser memory.
// Callers also reset() them once settled (see ConnectionsPanel).
const SECRET_MUTATION_GC_TIME = 0;

export function useConnections() {
  return useQuery({
    queryKey: CONNECTIONS_KEY,
    queryFn: async () => {
      const { data } = await apiClient.get<ConnectionOut[]>('/api/connections');
      return data;
    },
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ConnectionCreate) => {
      const { data } = await apiClient.post<ConnectionOut>('/api/connections', payload);
      return data;
    },
    gcTime: SECRET_MUTATION_GC_TIME,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: ConnectionUpdate }) => {
      const { data } = await apiClient.put<ConnectionOut>(`/api/connections/${id}`, payload);
      return data;
    },
    gcTime: SECRET_MUTATION_GC_TIME,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/api/connections/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  });
}

export function useSetDefaultConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ConnectionOut>(`/api/connections/${id}/set-default`);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  });
}

/** Tests unsaved connection settings (a new connection, or edits to a saved one). */
export function useTestConnectionDraft() {
  return useMutation({
    mutationFn: async (payload: ConnectionTestPayload) => {
      const { data } = await apiClient.post<ConnectionTestResult>('/api/connections/test', payload);
      return data;
    },
    gcTime: SECRET_MUTATION_GC_TIME,
  });
}

/** Tests a saved connection by id. */
export function useTestConnection() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ConnectionTestResult>(`/api/connections/${id}/test`);
      return data;
    },
  });
}
