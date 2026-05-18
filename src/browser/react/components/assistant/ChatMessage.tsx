import * as React from 'react';

import type { UiChatMessage } from '../../../../app/interfaces/Assistant';
import { useTranslation } from '../../hooks/useTranslation';
import { cn } from '../../lib/utils';
import { Icon } from '../Icon';
import { ToolCallCard } from './ToolCallCard';

/**
 * Single chat bubble. User messages render as a right-aligned solid
 * bubble with whitespace-preserved plain text. Assistant messages
 * render as a left-aligned markdown-rendered bubble — the renderer
 * is lazy-loaded from `core/Markdown` (which pulls in highlight.js
 * + KaTeX + the markdown-it plugins) so the assistant feature path
 * doesn't bloat the main bundle for users who never open the sidebar.
 *
 * Until the renderer lands the assistant bubble shows escaped plain
 * text — the cached renderer then arrives and a re-render swaps it
 * for the parsed markdown. The first chunks of a freshly-opened chat
 * sometimes paint as plain text for ~1 frame before the chunk lands;
 * acceptable trade for keeping the main bundle small.
 *
 * `renderAssistantMarkdown` flips markdown-it's `html: false` for the
 * duration of the call so raw HTML from the model doesn't reach the
 * DOM (XSS guard). See `core/Markdown.ts`.
 */
export const ChatMessage: React.FC<{ message: UiChatMessage }> = ({
  message,
}) => {
  const { t } = useTranslation();
  const isUser = message.role === 'user';

  return (
    <div
      data-testid={`chat-message-${message.id}`}
      data-role={message.role}
      data-status={message.status}
      className={cn(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-md px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground',
          message.status === 'failed' &&
            'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200',
          message.status === 'cancelled' && 'opacity-70',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <AssistantBody message={message} />
        )}

        {message.status === 'streaming' && message.content.length === 0 && (
          <span
            className="streaming-dot inline-block h-2 w-2 animate-pulse rounded-full bg-current"
            aria-label={t('assistant-chat:streaming')}
          />
        )}

        {message.status === 'cancelled' && (
          <p className="mt-2 text-xs italic text-muted-foreground">
            {t('assistant-chat:message_cancelled')}
          </p>
        )}

        {message.status === 'failed' && (
          <p className="mt-2 flex items-center gap-1 text-xs">
            <Icon name="exclamation-circle" />
            <span>
              {t(
                `assistant-settings:error_${message.errorCode ?? 'unknown'}`,
              )}
            </span>
          </p>
        )}

        {!isUser &&
          message.toolCalls &&
          message.toolCalls.length > 0 && (
            <div className="mt-1" data-testid="tool-call-list">
              {message.toolCalls.map((tc) => (
                <ToolCallCard key={tc.toolCallId} invocation={tc} />
              ))}
            </div>
          )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------- */
/*  Lazy markdown loader                                                  */
/* -------------------------------------------------------------------- */

type MarkdownRenderer = (content: string) => string;

let cachedRenderer: MarkdownRenderer | null = null;
let loaderPromise: Promise<MarkdownRenderer> | null = null;
const readyListeners = new Set<() => void>();

function loadAssistantMarkdownRenderer(): Promise<MarkdownRenderer> {
  if (cachedRenderer) return Promise.resolve(cachedRenderer);
  if (!loaderPromise) {
    loaderPromise = import('../../../core/Markdown').then((mod) => {
      cachedRenderer = mod.renderAssistantMarkdown;
      readyListeners.forEach((l) => l());
      return cachedRenderer;
    });
  }
  return loaderPromise;
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return ch;
    }
  });
}

/**
 * Renders the assistant bubble's body. Memoised on the message content
 * so a stream of chunks doesn't re-parse markdown unnecessarily mid-
 * render — markdown-it's render is fast but visible on long messages.
 *
 * Subscribes to the lazy-load signal so the bubble switches from the
 * plain-text fallback to parsed markdown as soon as the chunk lands.
 */
const AssistantBody: React.FC<{ message: UiChatMessage }> = React.memo(
  ({ message }) => {
    // `version` increments when the cached renderer transitions from
    // null to loaded; useSyncExternalStore re-runs the snapshot read
    // and triggers a re-render of this memoised body.
    const renderer = React.useSyncExternalStore(
      subscribeRenderer,
      getRenderer,
      getRenderer,
    );

    // Kick off the load once on mount. Subsequent mounts hit the
    // promise/cache; no duplicate work.
    React.useEffect(() => {
      void loadAssistantMarkdownRenderer();
    }, []);

    const html = React.useMemo(() => {
      if (!message.content) return '';
      if (!renderer) {
        // Plain-text fallback while the renderer loads. Wrap in <p>
        // + whitespace-pre-wrap so multi-line output reads naturally.
        return `<p style="white-space: pre-wrap">${escapeHtml(
          message.content,
        )}</p>`;
      }
      return renderer(message.content);
    }, [message.content, renderer]);

    if (!message.content) return null;
    return (
      <div
        className="prose prose-sm dark:prose-invert max-w-none [&_pre]:my-2 [&_p]:my-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  },
);
AssistantBody.displayName = 'AssistantBody';

function subscribeRenderer(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

function getRenderer(): MarkdownRenderer | null {
  return cachedRenderer;
}

/**
 * Optional preload entrypoint — `ProviderTab` calls this when the
 * sidebar is opened so the renderer starts loading before the user
 * sends their first message. Best-effort: failures are silently
 * swallowed (the plain-text fallback covers it).
 */
export function preloadAssistantMarkdown(): void {
  void loadAssistantMarkdownRenderer();
}
