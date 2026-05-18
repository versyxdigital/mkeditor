import * as React from 'react';

import type {
  ChatConversation,
  ProviderId,
} from '../../../../app/interfaces/Assistant';
import { confirmExternal } from '../../contexts/PromptsContext';
import { useAssistantChat } from '../../contexts/AssistantContext';
import { useTranslation } from '../../hooks/useTranslation';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Icon } from '../Icon';

interface ConversationListProps {
  provider: ProviderId;
  conversations: ChatConversation[];
  activeId: string | null;
}

/**
 * Left rail inside a `<ProviderTab>`: the list of conversations under
 * one provider plus a "new chat" affordance. Active row highlighted.
 *
 * Interactions:
 *   - click row    → activate
 *   - double-click → rename (inline editor, Enter commits, Esc cancels)
 *   - trash icon   → delete (with `confirmExternal` for safety)
 */
export const ConversationList: React.FC<ConversationListProps> = ({
  provider,
  conversations,
  activeId,
}) => {
  const { manager } = useAssistantChat();
  const { t } = useTranslation();
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState('');

  const handleNew = () => {
    if (!manager) return;
    manager.createConversation(provider);
  };

  const handleActivate = (id: string) => {
    if (!manager) return;
    manager.setActiveConversation(provider, id);
  };

  const beginRename = (conv: ChatConversation) => {
    setRenamingId(conv.id);
    setRenameDraft(conv.title);
  };

  const commitRename = () => {
    if (!manager || !renamingId) return;
    manager.renameConversation(provider, renamingId, renameDraft);
    setRenamingId(null);
    setRenameDraft('');
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft('');
  };

  const handleDelete = async (conv: ChatConversation) => {
    if (!manager) return;
    const ok = await confirmExternal({
      title: t('assistant-chat:delete_confirm_title'),
      description: t('assistant-chat:delete_confirm_text', {
        title: conv.title,
      }),
      confirmLabel: t('assistant-chat:delete_confirm_button'),
      cancelLabel: t('assistant-chat:delete_cancel_button'),
      destructive: true,
    });
    if (ok) {
      manager.deleteConversation(provider, conv.id);
    }
  };

  return (
    <div
      className="flex h-full flex-col border-r border-border"
      data-testid="conversation-list"
    >
      <div className="border-b border-border p-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full justify-start"
          onClick={handleNew}
          disabled={!manager}
          data-testid="conversation-new"
        >
          <Icon name="file" />
          <span>{t('assistant-chat:new_conversation')}</span>
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="p-3 text-center text-xs text-muted-foreground">
            {t('assistant-chat:no_conversations')}
          </p>
        ) : (
          <ul role="list" className="flex flex-col">
            {conversations.map((conv) => {
              const isActive = conv.id === activeId;
              const isRenaming = renamingId === conv.id;
              return (
                <li
                  key={conv.id}
                  role="listitem"
                  data-conversation-id={conv.id}
                  data-state={isActive ? 'active' : 'inactive'}
                  className={cn(
                    'group flex items-center gap-1 border-b border-border px-2 py-1.5 text-xs',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted',
                  )}
                  onClick={() => !isRenaming && handleActivate(conv.id)}
                  onDoubleClick={() => beginRename(conv)}
                >
                  {isRenaming ? (
                    <input
                      type="text"
                      value={renameDraft}
                      autoFocus
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        else if (e.key === 'Escape') cancelRename();
                      }}
                      className="flex-1 rounded border border-input bg-background px-1 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={t('assistant-chat:rename_aria')}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="flex-1 truncate"
                      title={conv.title}
                    >
                      {conv.title}
                    </span>
                  )}
                  {!isRenaming && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(conv);
                      }}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      aria-label={t('assistant-chat:delete_conversation', {
                        title: conv.title,
                      })}
                      data-testid={`conversation-delete-${conv.id}`}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
