import type { AgentProgressStep, ChatResponse } from '@/types/api';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  userText?: string;
  response?: ChatResponse;
  /** For an assistant message, the question that produced it - carried
   * alongside so it can be used as the pinned widget's title/question
   * without threading the whole message list through the bubble. */
  question?: string;
  /** True while this assistant message is awaiting the backend response. */
  pending?: boolean;
  /** Real AgentStatus events received over SSE so far, while pending. */
  liveProgress?: AgentProgressStep[];
}
