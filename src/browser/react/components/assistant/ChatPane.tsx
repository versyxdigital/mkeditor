import * as React from 'react';

import type {
  ChatConversation,
  InflightChatCall,
  ProviderId,
} from '../../../../app/interfaces/Assistant';
import type { AssistantManager } from '../../../core/AssistantManager';
import { useAssistantChat } from '../../contexts/AssistantContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import { Switch } from '../ui/switch';
import { Icon } from '../Icon';
import { ChatMessage } from './ChatMessage';

interface ChatPaneProps {
  provider: ProviderId;
  conversation: ChatConversation;
}

/**
 * The main chat surface for a single conversation.
 *
 * Composition: a small header (editable model id) + scrollable
 * message list with auto-scroll-to-bottom (suspended while the user
 * scrolls up) + textarea input with Enter-sends / Shift+Enter-newline
 * and a Send/Stop toggle keyed off whether this conversation has an
 * in-flight call.
 *
 * Draft preservation: the input is local React state for snappiness,
 * but is synced through `manager.setDraft` on tab/conversation switch
 * (component unmount or conversation prop change) and read back via
 * `manager.getDraft` on mount. Per-keystroke pushes are intentionally
 * NOT wired — they would emit a chat snapshot on every keypress and
 * trigger a chat-wide re-render.
 */
export const ChatPane: React.FC<ChatPaneProps> = ({
  provider,
  conversation,
}) => {
  const { chat, manager } = useAssistantChat();
  const { t } = useTranslation();

  const [draft, setDraft] = React.useState(() =>
    manager?.getDraft(provider, conversation.id) ?? '',
  );
  const [modelEditor, setModelEditor] = React.useState(conversation.model);

  // Latest-value ref so the unmount cleanup below can read the
  // current input without re-running on every keystroke (which would
  // re-trigger the unmount/remount cycle).
  const draftRef = React.useRef(draft);
  React.useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Re-seed local input + model state when the user switches to a
  // different conversation (the same component instance is reused
  // by ProviderTab; React doesn't unmount it on prop change).
  const prevConvId = React.useRef(conversation.id);
  React.useEffect(() => {
    if (prevConvId.current !== conversation.id) {
      // Persist the outgoing conversation's draft before swapping.
      if (manager) {
        manager.setDraft(provider, prevConvId.current, draft);
      }
      setDraft(manager?.getDraft(provider, conversation.id) ?? '');
      setModelEditor(conversation.model);
      prevConvId.current = conversation.id;
    }
    // Intentionally tracks `conversation.id` only (and the surrounding
    // identity deps); we do NOT include `draft` because a refresh on
    // every keystroke would create a feedback loop with `setDraft`.
  }, [conversation.id, conversation.model, manager, provider]);

  // Push the draft back into the manager when the component unmounts
  // (e.g. provider tab change). Reads via `draftRef.current` so the
  // latest typed value lands — closing over `draft` directly would
  // capture the initial mount value and lose every subsequent edit.
  // Cleanup runs once on unmount (empty deps). The latest input value
  // is read from `draftRef.current`, which is kept in sync by the
  // effect above.
  React.useEffect(() => {
    return () => {
      if (manager) {
        manager.setDraft(provider, conversation.id, draftRef.current);
      }
    };
  }, []);

  const inflight = React.useMemo<InflightChatCall | undefined>(() => {
    for (const call of Object.values(chat.inflight)) {
      if (
        call.provider === provider &&
        call.conversationId === conversation.id
      ) {
        return call;
      }
    }
    return undefined;
  }, [chat.inflight, provider, conversation.id]);

  const handleSend = React.useCallback(() => {
    if (!manager) return;
    if (inflight) return; // belt-and-braces; the button is disabled too
    const text = draft.trim();
    if (!text) return;
    manager.startCall(provider, conversation.id, text);
    setDraft('');
  }, [manager, inflight, draft, provider, conversation.id]);

  const handleStop = React.useCallback(() => {
    if (!manager || !inflight) return;
    manager.cancelCall(inflight.callId);
  }, [manager, inflight]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleModelBlur = React.useCallback(() => {
    if (!manager) return;
    manager.setConversationModel(provider, conversation.id, modelEditor);
  }, [manager, provider, conversation.id, modelEditor]);

  const handleAutoAcceptChange = React.useCallback(
    (value: boolean) => {
      if (!manager) return;
      manager.setAutoAcceptWrites(provider, conversation.id, value);
    },
    [manager, provider, conversation.id],
  );

  return (
    <div className="flex h-full flex-col" data-testid="chat-pane">
      <ChatHeader
        conversation={conversation}
        modelEditor={modelEditor}
        onModelChange={setModelEditor}
        onModelBlur={handleModelBlur}
        onAutoAcceptChange={handleAutoAcceptChange}
      />
      <MessageList messages={conversation.messages} />
      <div className="border-t border-border p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('assistant-chat:input_placeholder')}
            rows={2}
            className="flex-1 resize-none rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-testid="chat-input"
            aria-label={t('assistant-chat:input_aria')}
          />
          {inflight ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={handleStop}
              data-testid="chat-stop"
            >
              <Icon name="exclamation-circle" />
              <span>{t('assistant-chat:stop')}</span>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={handleSend}
              disabled={!draft.trim() || !manager}
              data-testid="chat-send"
            >
              <span>{t('assistant-chat:send')}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------- */
/*  Header — editable model id                                            */
/* -------------------------------------------------------------------- */

const ChatHeader: React.FC<{
  conversation: ChatConversation;
  modelEditor: string;
  onModelChange: (next: string) => void;
  onModelBlur: () => void;
  onAutoAcceptChange: (value: boolean) => void;
}> = ({
  conversation,
  modelEditor,
  onModelChange,
  onModelBlur,
  onAutoAcceptChange,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
      <span
        className="flex-1 truncate text-xs font-medium"
        title={conversation.title}
      >
        {conversation.title}
      </span>
      <label className="text-xs text-muted-foreground" htmlFor="chat-model">
        {t('assistant-chat:model_label')}
      </label>
      <Input
        id="chat-model"
        type="text"
        value={modelEditor}
        onChange={(e) => onModelChange(e.target.value)}
        onBlur={onModelBlur}
        className="h-6 w-40 text-xs"
        spellCheck={false}
        aria-label={t('assistant-chat:model_aria')}
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t('assistant-chat:options_aria')}
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            data-testid="chat-options"
          >
            <Icon name="cog" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-72 rounded-md border border-border bg-popover p-3 text-sm shadow-md"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <Label
                htmlFor="auto-accept-toggle"
                className="text-xs font-medium"
              >
                {t('assistant-chat:auto_accept_label')}
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('assistant-chat:auto_accept_help')}
              </p>
            </div>
            <Switch
              id="auto-accept-toggle"
              checked={conversation.autoAcceptWrites}
              onCheckedChange={onAutoAcceptChange}
              data-testid="chat-auto-accept"
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

/* -------------------------------------------------------------------- */
/*  Message list with auto-scroll                                         */
/* -------------------------------------------------------------------- */

/** Pixel distance from bottom within which auto-scroll stays engaged. */
const SCROLL_STICK_THRESHOLD = 32;

const MessageList: React.FC<{ messages: ChatConversation['messages'] }> = ({
  messages,
}) => {
  const { t } = useTranslation();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);

  // After every render, if we're sticking to the bottom, scroll there.
  // Tracking the last message's content length triggers this on chunk
  // appends without forcing the parent to re-render us deeper.
  const lastMessageContentLen =
    messages.length > 0 ? messages[messages.length - 1].content.length : 0;
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, lastMessageContentLen]);

  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    stickToBottom.current = distanceFromBottom <= SCROLL_STICK_THRESHOLD;
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
        {t('assistant-chat:empty_conversation')}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex flex-1 flex-col gap-2 overflow-y-auto p-2"
      data-testid="chat-message-list"
    >
      {messages.map((m) => (
        <ChatMessage key={m.id} message={m} />
      ))}
    </div>
  );
};

/* -------------------------------------------------------------------- */
/*  Exports for tests                                                     */
/* -------------------------------------------------------------------- */

export type { AssistantManager };
