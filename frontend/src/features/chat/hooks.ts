import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/services/apiClient';
import { streamChatMessage } from '@/services/chatStream';
import type { AgentProgressStep, ChatRequest, ConversationMessage, ConversationSummary } from '@/types/api';

export const chatKeys = {
  conversations: ['conversations'] as const,
  messages: (conversationId: string) => ['conversations', conversationId, 'messages'] as const,
};

export function useConversations() {
  return useQuery({
    queryKey: chatKeys.conversations,
    queryFn: async () => {
      const { data } = await apiClient.get<ConversationSummary[]>('/api/chat/conversations');
      return data;
    },
  });
}

export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: chatKeys.messages(conversationId ?? ''),
    queryFn: async () => {
      const { data } = await apiClient.get<ConversationMessage[]>(
        `/api/chat/conversations/${conversationId}/messages`,
      );
      return data;
    },
    enabled: !!conversationId,
  });
}

interface SendMessageVariables {
  payload: ChatRequest;
  onProgress: (step: AgentProgressStep) => void;
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, onProgress }: SendMessageVariables) => streamChatMessage(payload, { onProgress }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      queryClient.invalidateQueries({ queryKey: chatKeys.messages(data.conversation_id) });
    },
  });
}

/** Permanently deletes a conversation and its messages. */
export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      await apiClient.delete(`/api/chat/conversations/${conversationId}`);
    },
    onSuccess: (_data, conversationId) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      queryClient.removeQueries({ queryKey: chatKeys.messages(conversationId) });
    },
  });
}
