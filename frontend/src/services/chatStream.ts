import type { AgentProgressStep, ChatRequest, ChatResponse } from '@/types/api';
import { markReauthRequired } from '@/auth/sessionState';
import { getApiAuthHeaders } from './authHeaders';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

interface ChatStreamHandlers {
  onProgress: (step: AgentProgressStep) => void;
}

/**
 * Posts a chat message to the streaming endpoint and reads back
 * Server-Sent Events as the agent pipeline actually progresses - each real
 * `AgentStatus` arrives as an "progress" event as soon as that step
 * completes, followed by one final "result" event carrying the full
 * `ChatResponse`. Plain axios/EventSource can't do a streamed POST body, so
 * this reads the fetch response stream directly.
 */
export async function streamChatMessage(payload: ChatRequest, handlers: ChatStreamHandlers): Promise<ChatResponse> {
  const response = await fetch(`${BASE_URL}/api/chat/stream`, {
    method: 'POST',
    // This path bypasses the axios client, so it carries the bearer token itself.
    headers: { 'Content-Type': 'application/json', ...(await getApiAuthHeaders()) },
    body: JSON.stringify(payload),
  });
  if (response.status === 401) {
    markReauthRequired();
    throw new Error('Your sign-in has expired. Sign in again from the banner at the top, then resend your question.');
  }
  if (!response.ok || !response.body) {
    throw new Error(`Chat request failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: ChatResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseEvent(rawEvent);
      if (parsed?.event === 'progress') {
        handlers.onProgress(parsed.data as AgentProgressStep);
      } else if (parsed?.event === 'result') {
        result = parsed.data as ChatResponse;
      }
      boundary = buffer.indexOf('\n\n');
    }
  }

  if (!result) {
    throw new Error('Chat stream ended without a result.');
  }
  return result;
}

function parseSseEvent(raw: string): { event: string; data: unknown } | null {
  let event = 'message';
  let dataText = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataText += line.slice('data:'.length).trim();
  }
  if (!dataText) return null;
  try {
    return { event, data: JSON.parse(dataText) };
  } catch {
    return null;
  }
}
