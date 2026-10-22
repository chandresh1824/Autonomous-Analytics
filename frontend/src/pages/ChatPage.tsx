import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChatTabs } from '@/components/chat/ChatTabs';
import { MessageList } from '@/components/chat/MessageList';
import { AskBox } from '@/components/chat/AskBox';
import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { useToast } from '@/components/common/Toast';
import { PageHeader } from '@/components/layout/PageHeader';
import { type ChatTab, useChatSession } from '@/features/chat/ChatSessionContext';
import { useConversationMessages, useConversations, useDeleteConversation } from '@/features/chat/hooks';
import type { DisplayMessage } from '@/features/chat/types';
import { getApiErrorMessage } from '@/services/apiClient';

export function ChatPage() {
  const location = useLocation();
  const navigate = useNavigate();

  // Tabs live in ChatSessionProvider, above the routes, so they - and any
  // answer still streaming in - survive navigating away and back.
  const {
    tabs,
    activeKey,
    setActiveKey,
    isSending,
    restoreTabs,
    patchTab,
    sendInTab,
    startConversation: startInNewTab,
    removeTab,
  } = useChatSession();
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<ChatTab | null>(null);

  const conversationsQuery = useConversations();
  const deleteConversation = useDeleteConversation();
  const toast = useToast();

  const activeTab = tabs.find((t) => t.key === activeKey) ?? null;

  /* Restore recent conversations as tabs once per app session, so past chats
     stay reachable without a separate history panel. */
  useEffect(() => {
    if (conversationsQuery.data) restoreTabs(conversationsQuery.data);
  }, [conversationsQuery.data, restoreTabs]);

  // History for whichever tab is showing; other tabs keep what they have.
  const historyQuery = useConversationMessages(
    activeTab && !activeTab.hydrated ? activeTab.conversationId : null,
  );

  useEffect(() => {
    if (!activeTab || activeTab.hydrated) return;
    if (!historyQuery.data) return;
    let lastUserText = '';
    const replayed: DisplayMessage[] = historyQuery.data.map((m) => {
      if (m.role === 'user') {
        const content = m.content as { message: string };
        lastUserText = content.message;
        return { id: m.id, role: 'user', createdAt: m.created_at, userText: content.message };
      }
      return {
        id: m.id,
        role: 'assistant',
        createdAt: m.created_at,
        question: lastUserText,
        response: m.content as DisplayMessage['response'],
      };
    });
    patchTab(activeTab.key, (t) => ({ ...t, messages: replayed, hydrated: true }));
  }, [activeTab, historyQuery.data, patchTab]);

  const startConversation = (text: string) => {
    setNewChatOpen(false);
    startInNewTab(text);
  };

  /* A question asked from Home arrives as router state: ask it once, in its
     own tab, then clear the state so a refresh does not re-ask it. */
  const pendingQuestion = (location.state as { question?: string } | null)?.question;
  const askedRef = useRef(false);
  useEffect(() => {
    if (!pendingQuestion || askedRef.current) return;
    askedRef.current = true;
    navigate(location.pathname, { replace: true, state: null });
    startInNewTab(pendingQuestion);
  }, [pendingQuestion, startInNewTab, navigate, location.pathname]);

  /* The × on a tab asks for confirmation before anything happens - this only
     opens the dialog. */
  const requestCloseTab = (key: string) => {
    const tab = tabs.find((t) => t.key === key);
    if (tab) setCloseTarget(tab);
  };

  const confirmCloseTab = () => {
    if (!closeTarget) return;
    // A tab that never made it to the server (no question sent yet, or the
    // very first send is still in flight) has nothing to delete remotely.
    if (!closeTarget.conversationId) {
      removeTab(closeTarget.key);
      setCloseTarget(null);
      return;
    }
    deleteConversation.mutate(closeTarget.conversationId, {
      onSuccess: () => {
        removeTab(closeTarget.key);
        setCloseTarget(null);
      },
      onError: (error) => {
        toast.error(getApiErrorMessage(error, 'Could not delete this conversation.'));
      },
    });
  };

  const tabViews = tabs.map((t) => ({ key: t.key, title: t.title || 'New conversation' }));

  return (
    <div className="chat-page">
      <PageHeader title="Recent Conversations" />

      <div className="chat-shell">
        <ChatTabs
          tabs={tabViews}
          activeKey={activeKey}
          onSelect={setActiveKey}
          onClose={requestCloseTab}
          onNew={() => setNewChatOpen(true)}
        />

        <div className="chat-shell-body">
          <main className="chat-thread">
            {activeTab ? (
              <MessageList
                messages={activeTab.messages}
                loading={!activeTab.hydrated && historyQuery.isLoading}
              />
            ) : (
              <div className="message-list-empty">
                <EmptyState
                  icon={<Icon name="chat" size={26} />}
                  title="No conversation open"
                  description="Start a new one to ask a question about your data."
                  action={
                    <Button onClick={() => setNewChatOpen(true)}>
                      <Icon name="chat-new" size={15} />
                      <span>New conversation</span>
                    </Button>
                  }
                />
              </div>
            )}
          </main>
        </div>

        {activeTab && (
          <div className="chat-shell-footer">
            <AskBox
              variant="inline"
              placeholder="Ask a follow-up question…"
              onSend={(text) => sendInTab(activeTab.key, text)}
              disabled={isSending}
            />
          </div>
        )}
      </div>

      <Modal
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        title="New conversation"
        width={620}
      >
        <AskBox
          variant="hero"
          placeholder="Ask about KPIs, ticket trends, productivity"
          onSend={startConversation}
          autoFocus
        />
      </Modal>

      <ConfirmDialog
        open={closeTarget !== null}
        title="Delete conversation"
        message={`This permanently deletes "${
          closeTarget?.title || 'this conversation'
        }" and all of its messages. This can't be undone.`}
        confirmLabel="Delete"
        danger
        busy={deleteConversation.isPending}
        onConfirm={confirmCloseTab}
        onCancel={() => setCloseTarget(null)}
      />
    </div>
  );
}
