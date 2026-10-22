import { Icon } from '@/components/common/Icon';

export interface ChatTabView {
  key: string;
  title: string;
}

interface ChatTabsProps {
  tabs: ChatTabView[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onNew: () => void;
}

/**
 * Open conversations as a strip of tabs, with a new-conversation button at
 * the end. This replaces the history sidebar: switching conversations is a
 * tab click rather than a trip through a separate panel.
 */
export function ChatTabs({ tabs, activeKey, onSelect, onClose, onNew }: ChatTabsProps) {
  return (
    <div className="chat-tabs">
      <div className="chat-tabs-strip" role="tablist" aria-label="Conversations">
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          return (
            <div
              key={tab.key}
              className={`chat-tab ${isActive ? 'chat-tab-active' : ''}`}
              /* The tab itself is the button; the close control is a sibling
                 rather than a nested button, which is invalid HTML. */
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className="chat-tab-label"
                onClick={() => onSelect(tab.key)}
                title={tab.title}
              >
                {tab.title}
              </button>
              <button
                type="button"
                className="chat-tab-close"
                onClick={() => onClose(tab.key)}
                aria-label={`Close ${tab.title}`}
                title="Close this conversation"
              >
                <Icon name="close" size={13} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="chat-tabs-action"
        onClick={onNew}
        aria-label="New conversation"
        title="New conversation"
      >
        <Icon name="chat-new" size={18} />
      </button>
    </div>
  );
}
