import * as React from 'react';

import type {
  ChatConversation,
  InflightChatCall,
  ProviderId,
  ThinkingLevel,
} from '../../../../app/interfaces/Assistant';
import type {
  AssistantContextChip,
  AssistantManager,
} from '../../../core/AssistantManager';
import {
  useAssistantChat,
  useAssistantConfig,
} from '../../contexts/AssistantContext';
import { useFiles } from '../../contexts/FilesContext';
import { useManagers } from '../../contexts/ManagersContext';
import { useTranslation } from '../../hooks/useTranslation';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Switch } from '../ui/switch';
import { Icon } from '../Icon';
import { ChatMessage } from './ChatMessage';
import { ContextChipsRow } from './ContextChip';
import { MentionPicker } from './MentionPicker';
import { ProviderModelSettings } from './ProviderModelSettings';
import { OllamaChatModelSelect } from './OllamaChatModelSelect';

interface ChatPaneProps {
  provider: ProviderId;
  conversation: ChatConversation;
  /** True when the parent provider tab has collapsed the conversation rail. */
  convListCollapsed?: boolean;
  /** Toggle the parent provider tab's conversation rail open/closed. */
  onToggleConvList?: () => void;
}

/**
 * The main chat surface for a single conversation.
 *
 * Composition: a header with model/thinking dropdowns + scrollable
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
  convListCollapsed,
  onToggleConvList,
}) => {
  const { chat, manager } = useAssistantChat();
  const { t } = useTranslation();

  const [draft, setDraft] = React.useState(
    () => manager?.getDraft(provider, conversation.id) ?? '',
  );

  // Latest-value ref so the unmount cleanup below can read the
  // current input without re-running on every keystroke (which would
  // re-trigger the unmount/remount cycle).
  const draftRef = React.useRef(draft);
  React.useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Re-seed the local input when the user switches to a
  // different conversation (the same component instance is reused
  // by ProviderTab; React doesn't unmount it on prop change).
  const draftOwner = React.useRef({ provider, id: conversation.id, manager });
  React.useEffect(() => {
    const previous = draftOwner.current;
    if (
      previous.id !== conversation.id ||
      previous.provider !== provider ||
      previous.manager !== manager
    ) {
      // Persist the outgoing conversation's draft before swapping.
      previous.manager?.setDraft(
        previous.provider,
        previous.id,
        draftRef.current,
      );
      const nextDraft = manager?.getDraft(provider, conversation.id) ?? '';
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      draftOwner.current = { provider, id: conversation.id, manager };
    }
    // Intentionally tracks `conversation.id` only (and the surrounding
    // identity deps); we do NOT include `draft` because a refresh on
    // every keystroke would create a feedback loop with `setDraft`.
  }, [conversation.id, manager, provider]);

  // Push the draft back into the manager when the component unmounts
  // (e.g. provider tab change). Reads via `draftRef.current` so the
  // latest typed value lands — closing over `draft` directly would
  // capture the initial mount value and lose every subsequent edit.
  // Cleanup runs once on unmount (empty deps). The latest input value
  // is read from `draftRef.current`, which is kept in sync by the
  // effect above.
  React.useEffect(() => {
    return () => {
      const owner = draftOwner.current;
      owner.manager?.setDraft(owner.provider, owner.id, draftRef.current);
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

  // Chip row + token indicator re-render triggers.
  // `useFiles` keeps us in sync with active-file changes; `editorTick`
  // `files` snapshot drives re-derivation when the user switches tabs
  // (active file changes); `editorTick` bumps on Monaco selection
  // changes (Monaco doesn't surface a React-friendly hook for those).
  // Both need to be reachable as deps below or the chip memo + token
  // estimate will go stale on tab navigation / selection edits.
  const files = useFiles();
  const { editorManager, fileTreeManager } = useManagers();
  const [editorTick, bumpEditorTick] = React.useReducer(
    (n: number) => n + 1,
    0,
  );
  React.useEffect(() => {
    const ed = editorManager?.getMkEditor();
    if (!ed) return;
    const subscription = ed.onDidChangeCursorSelection(() => bumpEditorTick());
    return () => subscription.dispose();
  }, [editorManager]);

  // `conversation` covers toggle + mention edits via snapshot
  // identity; `chat` catches any manager-side rebuild; `files` catches
  // active-file changes; `editorTick` catches selection changes.
  const chips: AssistantContextChip[] = React.useMemo(
    () => (manager ? manager.contextChips(provider, conversation.id) : []),
    [manager, provider, conversation, chat, files, editorTick],
  );
  const tokenEstimate = React.useMemo(
    () =>
      manager
        ? manager.contextTokenEstimate(provider, conversation.id, draft)
        : 0,
    [manager, provider, conversation, chat, draft, files, editorTick],
  );

  // ---- @-mention picker state ---------------------------------------
  // We only open the picker when the user is actively typing a mention
  // token: the substring from the last `@` to the cursor must contain
  // no whitespace. That's a much friendlier UX than "open on any `@`"
  // — e.g. it doesn't pop up when the user types an email address.
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerQuery, setPickerQuery] = React.useState('');
  const [pickerAnchor, setPickerAnchor] = React.useState(-1); // index of `@` in draft

  const updatePickerFromInput = React.useCallback(
    (text: string, cursor: number) => {
      const before = text.slice(0, cursor);
      const at = before.lastIndexOf('@');
      if (at < 0) {
        setPickerOpen(false);
        return;
      }
      const candidate = before.slice(at + 1);
      // Bail out if there's whitespace between @ and cursor — that's
      // not a mention token.
      if (/\s/.test(candidate)) {
        setPickerOpen(false);
        return;
      }
      // Bail out if the character before @ is a non-whitespace, non-BOI
      // character (so emails like foo@bar.com don't trigger it).
      if (at > 0 && !/\s/.test(text[at - 1])) {
        setPickerOpen(false);
        return;
      }
      setPickerAnchor(at);
      setPickerQuery(candidate);
      setPickerOpen(true);
    },
    [],
  );

  const handleInputChange = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      draftRef.current = text;
      setDraft(text);
      updatePickerFromInput(text, e.target.selectionStart ?? text.length);
    },
    [updatePickerFromInput],
  );

  const handlePickerClose = React.useCallback(() => setPickerOpen(false), []);

  const handlePick = React.useCallback(
    (path: string) => {
      // Drop the @<query> token from the input and persist the mention
      // on the conversation. We deliberately do NOT insert a `[path]`
      // marker into the input — the mention chip below the textarea
      // is the visible affordance; the input stays a clean composition
      // surface.
      if (manager) void manager.addMention(provider, conversation.id, path);
      const at = pickerAnchor;
      const cursor = inputRef.current?.selectionStart ?? draft.length;
      const next = at >= 0 ? draft.slice(0, at) + draft.slice(cursor) : draft;
      draftRef.current = next;
      setDraft(next);
      setPickerOpen(false);
      // Restore focus + cursor position to where the `@` used to be.
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        if (at >= 0) el.setSelectionRange(at, at);
      });
    },
    [manager, provider, conversation.id, draft, pickerAnchor],
  );

  const preparingSend = React.useRef(false);
  const [isPreparingSend, setIsPreparingSend] = React.useState(false);
  const handleSend = React.useCallback(async () => {
    if (!manager) return;
    if (inflight || preparingSend.current) return;
    const text = draft.trim();
    if (!text) return;
    // Capture the draft up front so a slow contextFor() can't lose a
    // race with another keystroke.
    preparingSend.current = true;
    setIsPreparingSend(true);
    draftRef.current = '';
    setDraft('');
    setPickerOpen(false);
    let systemContext = null;
    try {
      systemContext = await manager.contextFor(provider, conversation.id);
    } catch {
      // Best-effort context — never block the send on a broken
      // mention or transient read failure.
    }
    try {
      manager.startCall(provider, conversation.id, text, systemContext);
    } finally {
      preparingSend.current = false;
      setIsPreparingSend(false);
    }
  }, [manager, inflight, draft, provider, conversation.id]);

  const handleStop = React.useCallback(() => {
    if (!manager || !inflight) return;
    manager.cancelCall(inflight.callId);
  }, [manager, inflight]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing) return;
      // While the mention picker owns Enter / Arrow keys, don't send.
      if (pickerOpen && (e.key === 'Enter' || e.key.startsWith('Arrow'))) {
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend, pickerOpen],
  );

  // Chat-wide keyboard shortcuts. Attached to the pane root via
  // capture-phase listener so they work when the textarea OR the
  // message list / chip row / header is focused:
  //
  //   Esc        — cancel the in-flight call (no-op when nothing
  //                is streaming; we don't swallow Esc otherwise so
  //                Radix popovers / dialogs keep their dismiss key).
  //   Cmd/Ctrl+K — open a new conversation on this provider tab.
  //   Cmd/Ctrl+/ — focus the input from anywhere in the pane.
  const paneRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape' && inflight && !pickerOpen) {
        e.preventDefault();
        manager?.cancelCall(inflight.callId);
        return;
      }
      if (meta && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (manager) manager.createConversation(provider);
        return;
      }
      if (meta && e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [manager, inflight, pickerOpen, provider]);

  const handleModelChange = React.useCallback(
    (model: string) => {
      manager?.setConversationModel(provider, conversation.id, model);
    },
    [manager, provider, conversation.id],
  );
  const handleThinkingChange = React.useCallback(
    (level: ThinkingLevel) => {
      manager?.setConversationThinkingLevel(provider, conversation.id, level);
    },
    [manager, provider, conversation.id],
  );

  const handleAutoAcceptChange = React.useCallback(
    (value: boolean) => {
      if (!manager) return;
      manager.setAutoAcceptWrites(provider, conversation.id, value);
    },
    [manager, provider, conversation.id],
  );
  const handleShareActiveFileChange = React.useCallback(
    (value: boolean) => {
      if (!manager) return;
      manager.setShareActiveFile(provider, conversation.id, value);
    },
    [manager, provider, conversation.id],
  );
  const handleShareSelectionChange = React.useCallback(
    (value: boolean) => {
      if (!manager) return;
      manager.setShareSelection(provider, conversation.id, value);
    },
    [manager, provider, conversation.id],
  );

  // ---- chip-removal handlers (per-kind) -----------------------------
  const handleRemoveActive = React.useCallback(() => {
    if (manager) manager.setShareActiveFile(provider, conversation.id, false);
  }, [manager, provider, conversation.id]);
  const handleRemoveSelection = React.useCallback(() => {
    if (manager) manager.setShareSelection(provider, conversation.id, false);
  }, [manager, provider, conversation.id]);
  const handleRemoveMention = React.useCallback(
    (path: string) => {
      if (manager) manager.removeMention(provider, conversation.id, path);
    },
    [manager, provider, conversation.id],
  );

  const tokenIndicatorClass = cn(
    'text-xs text-muted-foreground',
    // Amber-warn over a rough "small-ish window" threshold. Doc
    // mentions the provider's published context window; we don't
    // ship per-provider limits in v1 — 32k is a safe shared floor
    // that flags clearly-large prompts without spamming for normal use.
    tokenEstimate > 32000 && 'text-warning font-medium',
  );

  return (
    <div
      ref={paneRef}
      className="flex h-full min-w-0 flex-col"
      data-testid="chat-pane"
      tabIndex={-1}
    >
      <ChatHeader
        conversation={conversation}
        onAutoAcceptChange={handleAutoAcceptChange}
        onShareActiveFileChange={handleShareActiveFileChange}
        onShareSelectionChange={handleShareSelectionChange}
        convListCollapsed={convListCollapsed}
        onToggleConvList={onToggleConvList}
      />
      <MessageList
        key={`${provider}:${conversation.id}`}
        messages={conversation.messages}
      />
      <ContextChipsRow
        chips={chips}
        onRemoveActive={handleRemoveActive}
        onRemoveSelection={handleRemoveSelection}
        onRemoveMention={handleRemoveMention}
      />
      <div className="relative border-t border-border p-2">
        <MentionPicker
          query={pickerQuery}
          open={pickerOpen}
          onPick={handlePick}
          onClose={handlePickerClose}
          fileTreeManager={fileTreeManager}
        />
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={t('assistant-chat:input_placeholder')}
            rows={2}
            className="min-w-0 flex-1 resize-none rounded-md border border-border bg-editor px-2 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              onClick={() => void handleSend()}
              disabled={!draft.trim() || !manager || isPreparingSend}
              data-testid="chat-send"
            >
              <span>{t('assistant-chat:send')}</span>
            </Button>
          )}
        </div>
        <div
          className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"
          data-testid="chat-composer-controls"
        >
          <ConversationModelControls
            provider={provider}
            conversation={conversation}
            onModelChange={handleModelChange}
            onThinkingChange={handleThinkingChange}
          />
          <div
            className={cn('ml-auto shrink-0', tokenIndicatorClass)}
            data-testid="context-token-estimate"
            aria-live="polite"
          >
            {t('assistant-chat:token_estimate', {
              // Use a non-`count` key so i18next's plural magic doesn't
              // mangle the value (the previous `count` route was
              // rendering as a literal minus sign in some locales /
              // browsers — likely an unintended interaction between
              // i18next's count handling and the locale's
              // number-formatting rules).
              tokens: tokenEstimate.toLocaleString(),
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------- */
/*  Header — conversation title and options                                */
/* -------------------------------------------------------------------- */

const ChatHeader: React.FC<{
  conversation: ChatConversation;
  onAutoAcceptChange: (value: boolean) => void;
  onShareActiveFileChange: (value: boolean) => void;
  onShareSelectionChange: (value: boolean) => void;
  /** True when the parent provider tab has collapsed the conversation rail. */
  convListCollapsed?: boolean;
  /** Toggle the parent provider tab's conversation rail open/closed. */
  onToggleConvList?: () => void;
}> = ({
  conversation,
  onAutoAcceptChange,
  onShareActiveFileChange,
  onShareSelectionChange,
  convListCollapsed,
  onToggleConvList,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 border-b border-border px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        {onToggleConvList && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onToggleConvList}
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            aria-label={t(
              convListCollapsed
                ? 'assistant-chat:show_conversations_aria'
                : 'assistant-chat:hide_conversations_aria',
            )}
            aria-expanded={!convListCollapsed}
            data-testid="chat-toggle-conv-list"
          >
            <Icon name={convListCollapsed ? 'chevron-right' : 'chevron-left'} />
          </Button>
        )}
        <span
          className="flex-1 truncate text-xs font-medium"
          title={conversation.title}
        >
          {conversation.title}
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('assistant-chat:options_aria')}
              title={t('assistant-chat:options_aria')}
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              data-testid="chat-options"
            >
              <Icon name="cog" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-72 space-y-3 rounded-lg border border-border bg-popover p-3 text-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <Label
                  htmlFor="share-active-file-toggle"
                  className="text-xs font-medium"
                >
                  {t('assistant-chat:share_active_file_label')}
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('assistant-chat:share_active_file_help')}
                </p>
              </div>
              <Switch
                id="share-active-file-toggle"
                checked={conversation.shareActiveFile}
                onCheckedChange={onShareActiveFileChange}
                data-testid="chat-share-active-file"
              />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <Label
                  htmlFor="share-selection-toggle"
                  className="text-xs font-medium"
                >
                  {t('assistant-chat:share_selection_label')}
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('assistant-chat:share_selection_help')}
                </p>
              </div>
              <Switch
                id="share-selection-toggle"
                checked={conversation.shareSelection}
                onCheckedChange={onShareSelectionChange}
                data-testid="chat-share-selection"
              />
            </div>
            <div className="flex items-start justify-between gap-3 border-t border-border pt-3">
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
    </div>
  );
};

/** Per-conversation controls sit quietly beneath the message input. */
const ConversationModelControls: React.FC<{
  provider: ProviderId;
  conversation: ChatConversation;
  onModelChange: (model: string) => void;
  onThinkingChange: (level: ThinkingLevel) => void;
}> = ({ provider, conversation, onModelChange, onThinkingChange }) => {
  const { t } = useTranslation();
  const { snapshot, manager } = useAssistantConfig();
  const preference =
    provider !== 'ollama'
      ? snapshot.config?.[provider].thinkingLevel
      : undefined;
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
      {provider !== 'ollama' ? (
        <ProviderModelSettings
          key={`${provider}:${conversation.id}`}
          idPrefix="chat"
          provider={provider}
          model={conversation.model}
          modelLabel={t('assistant-chat:model_label')}
          modelAriaLabel={t('assistant-chat:model_aria')}
          thinkingLevel={conversation.thinkingLevel ?? preference}
          onModelChange={onModelChange}
          onThinkingChange={onThinkingChange}
          compact
        />
      ) : (
        <OllamaChatModelSelect
          compact
          key={conversation.id}
          model={conversation.model}
          onChange={onModelChange}
          loadModels={() =>
            manager?.refreshOllamaModels(
              snapshot.config?.ollama.baseUrl ?? 'http://localhost:11434',
            ) ?? Promise.resolve([])
          }
        />
      )}
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
    const distanceFromBottom =
      el.scrollHeight - (el.scrollTop + el.clientHeight);
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
      // `min-w-0` on this flex column prevents wide message content
      // (long code lines, URLs) from forcing the column to its
      // intrinsic min-content width, which would push the surrounding
      // sidebar Panel wider than the user dragged it.
      className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-2"
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
