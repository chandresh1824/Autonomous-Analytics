import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/services/apiClient';
import type {
  DatasourceTableInfo,
  IndexResult,
  PublishResult,
  RelationshipSuggestion,
  SemanticModel,
  SemanticModelVersion,
  SemanticValidationResult,
} from '@/types/api';

// A model/version list is scoped per-datasource on the backend (see
// ConnectionModel.id doubling as data_source_id) - keying every query by
// connectionId (falling back to a fixed 'default' segment when none is
// selected yet, matching the backend's own default-connection fallback) is
// what lets each datasource's cache coexist instead of one clobbering
// another's.
const BASE_KEY = ['semantic-model'] as const;
const modelKey = (connectionId?: string, publishedOnly?: boolean) =>
  [...BASE_KEY, 'model', connectionId ?? 'default', publishedOnly ? 'published' : 'working'] as const;
const versionsKey = (connectionId?: string) => [...BASE_KEY, 'versions', connectionId ?? 'default'] as const;

function withConnectionParam(path: string, connectionId?: string): string {
  return connectionId ? `${path}?connection_id=${encodeURIComponent(connectionId)}` : path;
}

/** `publishedOnly` (default false, the latest version regardless of status)
 * must be true for any UI that should never show an unpublished draft as if
 * it were the live model (the Settings page) - callers that specifically
 * need to see an in-progress draft (the generation wizard's resume flow)
 * leave it false. */
export function useSemanticModel(connectionId?: string, publishedOnly?: boolean, enabled = true) {
  return useQuery({
    queryKey: modelKey(connectionId, publishedOnly),
    enabled,
    queryFn: async () => {
      const path = withConnectionParam('/api/semantic-model', connectionId);
      const url = publishedOnly ? `${path}${path.includes('?') ? '&' : '?'}published_only=true` : path;
      const { data } = await apiClient.get<SemanticModel>(url);
      return data;
    },
  });
}

export function useSemanticModelVersions(connectionId?: string) {
  return useQuery({
    queryKey: versionsKey(connectionId),
    queryFn: async () => {
      const { data } = await apiClient.get<SemanticModelVersion[]>(
        withConnectionParam('/api/semantic-model/versions', connectionId),
      );
      return data;
    },
  });
}

export function useValidateSemanticModel() {
  return useMutation({
    mutationFn: async (model: SemanticModel) => {
      const { data } = await apiClient.post<SemanticValidationResult>(
        '/api/semantic-model/validate',
        model,
      );
      return data;
    },
  });
}

// Every mutation below invalidates the whole 'semantic-model' key prefix
// (every datasource's cached model + versions) rather than just the one it
// acted on - simpler than threading "which connection's cache to refresh"
// out of a mutation that doesn't otherwise need to know, and refetching a
// few extra datasources' data is harmless.
export function useImportSemanticModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ model, connectionId }: { model: SemanticModel; connectionId?: string }) => {
      const { data } = await apiClient.post<SemanticValidationResult>(
        withConnectionParam('/api/semantic-model/import', connectionId),
        model,
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BASE_KEY });
    },
  });
}

export function useUploadSemanticModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, connectionId }: { file: File; connectionId?: string }) => {
      const form = new FormData();
      form.append('file', file);
      const { data } = await apiClient.post<SemanticValidationResult>(
        withConnectionParam('/api/semantic-model/upload', connectionId),
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BASE_KEY });
    },
  });
}

export function usePublishSemanticModelVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ versionId, connectionId }: { versionId: string; connectionId?: string }) => {
      const { data } = await apiClient.post<PublishResult>(
        withConnectionParam(`/api/semantic-model/${versionId}/publish`, connectionId),
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BASE_KEY });
    },
  });
}

export function useDeleteSemanticModelVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ versionId, connectionId }: { versionId: string; connectionId?: string }) => {
      await apiClient.delete(withConnectionParam(`/api/semantic-model/${versionId}`, connectionId));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BASE_KEY });
    },
  });
}

export function useIndexSemanticModel() {
  return useMutation({
    mutationFn: async (connectionId?: string) => {
      const { data } = await apiClient.post<IndexResult>(
        withConnectionParam('/api/semantic-model/index', connectionId),
      );
      return data;
    },
  });
}

export function useDatasourceTables(connectionId: string) {
  return useQuery({
    queryKey: ['semantic-model', 'tables', connectionId],
    queryFn: async () => {
      const { data } = await apiClient.get<DatasourceTableInfo[]>(
        `/api/semantic-model/tables?connection_id=${encodeURIComponent(connectionId)}`,
      );
      return data;
    },
    enabled: !!connectionId,
  });
}

/** `columns` optionally limits generation to specific columns per table
 * (tables not listed use all their columns). */
export function useGenerateSemanticModel() {
  return useMutation({
    mutationFn: async ({
      connectionId,
      tables,
      columns,
    }: {
      connectionId: string;
      tables: string[];
      columns?: Record<string, string[]>;
    }) => {
      const params = new URLSearchParams({ connection_id: connectionId });
      for (const table of tables) params.append('tables', table);
      const { data } = await apiClient.post<SemanticModel>(
        `/api/semantic-model/generate?${params.toString()}`,
        columns ? { columns } : undefined,
      );
      return data;
    },
  });
}

export function useSuggestRelationships() {
  return useMutation({
    mutationFn: async ({ connectionId, tables }: { connectionId: string; tables: string[] }) => {
      const params = new URLSearchParams({ connection_id: connectionId });
      for (const table of tables) params.append('tables', table);
      const { data } = await apiClient.get<RelationshipSuggestion[]>(
        `/api/semantic-model/relationships/suggest?${params.toString()}`,
      );
      return data;
    },
  });
}

export function useSuggestSynonyms() {
  return useMutation({
    mutationFn: async (payload: { entity_name: string; field_name: string; description: string }) => {
      const { data } = await apiClient.post<{ synonyms: string[] }>(
        '/api/semantic-model/synonyms/suggest',
        payload,
      );
      return data.synonyms;
    },
  });
}

/**
 * Publishes the latest working (draft) version for a connection as a new
 * version - the one shared "make my changes live" action for everything
 * that lives in the semantic model (entities, dimensions, measures,
 * relationships, synonyms, metrics, and KPIs all version together as a
 * single model), surfaced by the Semantic Model page's `DraftActions`.
 */
export function usePublishLatestVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId?: string) => {
      const { data } = await apiClient.post<PublishResult>(withConnectionParam('/api/semantic-model/publish', connectionId));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BASE_KEY });
    },
  });
}

/** Saves the model as the connection's draft, then immediately publishes it (replacing that connection's published model) in
 * the same action - used by the generation wizard's final Publish step so
 * nothing reaches the database until the user confirms there, never as an
 * intermediate "draft" they'd have to separately find and publish. */
export function usePublishSemanticModel() {
  const queryClient = useQueryClient();
  const importModel = useImportSemanticModel();
  const publishVersion = usePublishSemanticModelVersion();
  return useMutation({
    mutationFn: async ({ model, connectionId }: { model: SemanticModel; connectionId?: string }) => {
      const result = await importModel.mutateAsync({ model, connectionId });
      if (!result.version_id) {
        throw new Error('The server did not return a version id for the saved draft.');
      }
      return publishVersion.mutateAsync({ versionId: result.version_id, connectionId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BASE_KEY });
    },
  });
}

function sameModelContent(a: SemanticModel, b: SemanticModel): boolean {
  const pick = (m: SemanticModel) => JSON.stringify({ entities: m.entities, metrics: m.metrics, kpis: m.kpis });
  return pick(a) === pick(b);
}

/**
 * Saves a reverted copy of the working model (some or all draft changes put
 * back to the published model). When the result no longer differs from the
 * published model - or `removeDraft` is set - the draft version is deleted
 * outright instead, so no empty "unpublished changes" draft is left behind.
 */
export function useRevertSemanticDraft(connectionId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      model,
      published,
      draftVersionId,
      removeDraft,
    }: {
      model: SemanticModel;
      published?: SemanticModel;
      draftVersionId: string;
      removeDraft?: boolean;
    }) => {
      if (removeDraft || (published && sameModelContent(model, published))) {
        await apiClient.delete(withConnectionParam(`/api/semantic-model/${draftVersionId}`, connectionId));
        return { draftRemoved: true };
      }
      await apiClient.post<SemanticValidationResult>(
        withConnectionParam('/api/semantic-model/import', connectionId),
        model,
      );
      return { draftRemoved: false };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BASE_KEY });
    },
  });
}
