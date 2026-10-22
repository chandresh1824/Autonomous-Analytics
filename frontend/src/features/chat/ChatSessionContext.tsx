import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { getApiErrorMessage } from '@/services/apiClient';
import type { ConversationSummary } from '@/types/api';
import { useSendMessage } from './hooks';
import type { DisplayMessage } from './types';

/** How many recent conversations are restored as tabs on arrival. */
const RESTORED_TAB_LIMIT = 8;

export interface ChatTab {
  /** Stable local id: survives the server assigning a conversation id later. */
  key: string;
  conversationId: string | null;
  title: string;
  messages: DisplayMessage[];
  /** True once history has been replayed (or the tab started empty). */
  hydrated: boolean;
}

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

interface ChatSessionValue {
  tabs: ChatTab[];
  activeKey: string | null;
  setActiveKey: (key: string | null) => void;
  /** True while any question is still being answered. */
  isSending: boolean;
  /** Adds the server's recent conversations as tabs - only the first call
   * per app session does anything. */
  restoreTabs: (summaries: ConversationSummary[]) => void;
  patchTab: (key: string, patch: (tab: ChatTab) => ChatTab) => void;
  sendInTab: (tabKey: string, text: string) => void;
  /** Opens a fresh tab and asks `text` in it. */
  startConversation: (text: string) => void;
  removeTab: (key: string) => void;
}

const ChatSessionContext = createContext<ChatSessionValue | null>(null);

/**
 * Holds the open conversation tabs above the routes, so leaving the chat page
 * and coming back keeps every tab as it was - including an answer that is
 * still streaming in, whose progress keeps landing here while the page is
 * not mounted.
 */
export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const sendMessage = useSendMessage();

  // Latest tabs for callbacks that must not go stale mid-stream.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const restoredRef = useRef(false);
  const restoreTabs = useCallback((summaries: ConversationSummary[]) => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (summaries.length === 0) return;

    const restored: ChatTab[] = summaries.slice(0, RESTORED_TAB_LIMIT).map((summary) => ({
      key: nextId('tab'),
      conversationId: summary.id,
      title: summary.title || 'Untitled conversation',
      messages: [],
      hydrated: false,
    }));
    setTabs((prev) => [...restored, ...prev]);
    setActiveKey((prev) => prev ?? restored[0].key);
  }, []);

  const patchTab = useCallback((key: string, patch: (tab: ChatTab) => ChatTab) => {
    setTabs((prev) => prev.map((t) => (t.key === key ? patch(t) : t)));
  }, []);

  const sendInTab = useCallback(
    (tabKey: string, text: string) => {
      const pendingId = nextId('assistant');
      patchTab(tabKey, (tab) => ({
        ...tab,
        title: tab.title || text,
        messages: [
          ...tab.messages,
          { id: nextId('user'), role: 'user', createdAt: new Date().toISOString(), userText: text },
          {
            id: pendingId,
            role: 'assistant',
            createdAt: new Date().toISOString(),
            question: text,
            pending: true,
            liveProgress: [],
          },
        ],
      }));

      const conversationId = tabsRef.current.find((t) => t.key === tabKey)?.conversationId ?? undefined;

      // mutateAsync rather than per-call mutate callbacks: those only fire for
      // the most recent mutate call, which would drop the result of an earlier
      // question still streaming in another tab.
      setInFlight((n) => n + 1);
      sendMessage
        .mutateAsync({
          payload: { conversation_id: conversationId, message: text },
          onProgress: (step) => {
            patchTab(tabKey, (tab) => ({
              ...tab,
              messages: tab.messages.map((m) =>
                m.id === pendingId ? { ...m, liveProgress: [...(m.liveProgress ?? []), step] } : m,
              ),
            }));
          },
        })
        .then((data) => {
          patchTab(tabKey, (tab) => ({
            ...tab,
            conversationId: data.conversation_id,
            hydrated: true,
            messages: tab.messages.map((m) =>
              m.id === pendingId ? { ...m, id: data.message_id, pending: false, response: data } : m,
            ),
          }));
        })
        .catch((error) => {
          const errorText = getApiErrorMessage(error, 'The request failed. Please try again.');
          patchTab(tabKey, (tab) => ({
            ...tab,
            messages: tab.messages.map((m) =>
              m.id === pendingId
                ? {
                    ...m,
                    pending: false,
                    response: {
                      conversation_id: tab.conversationId ?? '',
                      message_id: pendingId,
                      request_id: '',
                      status: 'error',
                      summary: '',
                      insights: [],
                      visualization: null,
                      table: null,
                      metadata: {
                        kpis: [],
                        metrics: [],
                        dimensions: [],
                        execution_time_ms: 0,
                        row_count: 0,
                      },
                      sql: null,
                      progress: [],
                      errors: [errorText],
                    },
                  }
                : m,
            ),
          }));
        })
        .finally(() => setInFlight((n) => n - 1));
    },
    [patchTab, sendMessage],
  );

  const startConversation = useCallback(
    (text: string) => {
      const tab: ChatTab = {
        key: nextId('tab'),
        conversationId: null,
        title: text,
        messages: [],
        hydrated: true,
      };
      setTabs((prev) => [...prev, tab]);
      setActiveKey(tab.key);
      sendInTab(tab.key, text);
    },
    [sendInTab],
  );

  const removeTab = useCallback((key: string) => {
    const prev = tabsRef.current;
    const index = prev.findIndex((t) => t.key === key);
    const next = prev.filter((t) => t.key !== key);
    setTabs(next);
    setActiveKey((current) => {
      if (current !== key) return current;
      const neighbour = next[index] ?? next[index - 1] ?? null;
      return neighbour?.key ?? null;
    });
  }, []);

  const value = useMemo<ChatSessionValue>(
    () => ({
      tabs,
      activeKey,
      setActiveKey,
      isSending: inFlight > 0,
      restoreTabs,
      patchTab,
      sendInTab,
      startConversation,
      removeTab,
    }),
    [tabs, activeKey, inFlight, restoreTabs, patchTab, sendInTab, startConversation, removeTab],
  );

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>;
}

export function useChatSession(): ChatSessionValue {
  const value = useContext(ChatSessionContext);
  if (!value) throw new Error('useChatSession must be used inside ChatSessionProvider');
  return value;
}
