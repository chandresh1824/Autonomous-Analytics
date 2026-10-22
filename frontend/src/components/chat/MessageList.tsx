import { useEffect, useRef } from 'react';
import type { DisplayMessage } from '@/features/chat/types';
import { MessageBubble } from './MessageBubble';
import { EmptyState } from '@/components/common/EmptyState';
import { Icon } from '@/components/common/Icon';

interface MessageListProps {
  messages: DisplayMessage[];
  loading?: boolean;
}

export function MessageList({ messages, loading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.pending]);

  if (!loading && messages.length === 0) {
    return (
      <div className="message-list-empty">
        <EmptyState
          icon={<Icon name="chat" size={26} />}
          title="Ask a question about your data"
          description='Try something like "What is the total resolved cases by priority this quarter?"'
        />
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
