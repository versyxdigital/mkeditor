import * as React from 'react';
import {
  Group,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from 'react-resizable-panels';

import type { ProviderId } from '../../../../app/interfaces/Assistant';
import { useAssistantChat } from '../../contexts/AssistantContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/button';
import { Icon } from '../Icon';
import { ChatPane } from './ChatPane';
import { ConversationList } from './ConversationList';
import { preloadAssistantMarkdown } from './ChatMessage';

interface ProviderTabProps {
  provider: ProviderId;
}

/**
 * One enabled-provider's tab body in the AI Assistant sidebar.
 *
 * Layout: horizontal `react-resizable-panels` split. Left rail =
 * `<ConversationList>` (default 35%, min 20%). Right = `<ChatPane>`
 * for the active conversation. When the provider has no conversations
 * yet, render a single-pane "Start a conversation" empty state with
 * a button that creates the first conversation — the split kicks in
 * once there's at least one.
 *
 * Manager + active conversation come from `useAssistantChat`, so the
 * component re-renders on chunk arrivals + active-conv changes.
 */
export const ProviderTab: React.FC<ProviderTabProps> = ({ provider }) => {
  const { chat, manager } = useAssistantChat();
  const { t } = useTranslation();

  // Kick off the markdown renderer load eagerly the first time the
  // user opens any provider tab. The first chunks of their first
  // message land seconds later — the lazy chunk should be on disk by
  // then so the bubbles paint as parsed markdown from the start.
  React.useEffect(() => {
    preloadAssistantMarkdown();
  }, []);

  const conversations = chat.conversations[provider];
  const activeId = chat.activeConversation[provider];
  const active = activeId
    ? conversations.find((c) => c.id === activeId)
    : undefined;

  // Collapse/expand the conversation list rail. The Panel's
  // `collapsible` lets the user drag the gutter onto the edge to
  // collapse it; the chevron in the chat header gives them a one-
  // click toggle, which matches how the main left-sidebar collapse
  // works. `convListCollapsed` is local React state we keep in sync
  // with the panel via its imperative ref + an onResize watcher
  // (size==0 → collapsed) so a drag-gutter collapse also flips the
  // chevron orientation. Each provider remembers its own preference
  // for the lifetime of the session.
  const convPanelRef = React.useRef<PanelImperativeHandle>(null);
  const [convListCollapsed, setConvListCollapsed] = React.useState(false);
  const toggleConvList = React.useCallback(() => {
    const panel = convPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setConvListCollapsed(false);
    } else {
      panel.collapse();
      setConvListCollapsed(true);
    }
  }, []);
  const handleConvPanelResize = React.useCallback(
    (size: { asPercentage: number }) => {
      const next = size.asPercentage <= 0;
      setConvListCollapsed((prev) => (prev === next ? prev : next));
    },
    [],
  );

  if (conversations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Icon name="comments" className="text-3xl text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {t('assistant-chat:no_conversations_cta', { provider })}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => manager?.createConversation(provider)}
          disabled={!manager}
          data-testid="conversation-new-empty"
        >
          <Icon name="file" />
          <span>{t('assistant-chat:start_conversation')}</span>
        </Button>
      </div>
    );
  }

  return (
    <Group orientation="horizontal" id={`assistant-${provider}-split`}>
      <Panel
        id={`${provider}-conversations`}
        panelRef={convPanelRef}
        collapsible
        defaultSize="35%"
        minSize="20%"
        onResize={handleConvPanelResize}
      >
        <ConversationList
          provider={provider}
          conversations={conversations}
          activeId={activeId}
        />
      </Panel>
      <Separator className="gutter sidebar-gutter-horizontal" />
      <Panel id={`${provider}-chat`}>
        {active ? (
          <ChatPane
            provider={provider}
            conversation={active}
            convListCollapsed={convListCollapsed}
            onToggleConvList={toggleConvList}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
            {t('assistant-chat:select_conversation')}
          </div>
        )}
      </Panel>
    </Group>
  );
};
