import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/services/apiClient';
import type { LogEntry } from '@/types/api';

export interface LogsFilter {
  level?: string;
  q?: string;
  limit?: number;
}

export function useLogs(filter: LogsFilter, refetchInterval: number | false = false) {
  return useQuery({
    queryKey: ['logs', filter],
    queryFn: async () => {
      const { data } = await apiClient.get<LogEntry[]>('/api/logs', { params: filter });
      return data;
    },
    refetchInterval,
  });
}
