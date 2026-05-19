import * as React from 'react';

import type {
  ToolInvocation,
  UiChatMessage,
} from '../../../../app/interfaces/Assistant';
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
      // `min-w-0` is critical inside a flex column — without it the
      // bubble's intrinsic content min-width (driven by long code lines
      // or URLs) bubbles up and expands the entire chat pane, pushing
      // the right sidebar wider than the user dragged it.
      className={cn(
        'flex w-full min-w-0',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={cn(
          'max-w-[85%] min-w-0 rounded-md px-3 py-2 text-[13px]',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground',
          message.status === 'failed' &&
            'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200',
          message.status === 'cancelled' && 'opacity-70',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <AssistantBody message={message} />
        )}

        {message.status === 'streaming' && message.content.length === 0 && (
          <ThinkingIndicator />
        )}

        {message.status === 'cancelled' && (
          <p className="mt-2 text-xs italic text-muted-foreground">
            {t('assistant-chat:message_cancelled')}
          </p>
        )}

        {message.status === 'failed' && (
          <div className="mt-2 flex flex-col gap-0.5 text-xs">
            <p className="flex items-center gap-1">
              <Icon name="exclamation-circle" />
              <span>
                {t(
                  `assistant-settings:error_${message.errorCode ?? 'unknown'}`,
                )}
              </span>
            </p>
            {message.errorMessage && (
              // Upstream detail (e.g. Ollama's "gemma3:4b does not
              // support tools") — useful for debugging even when the
              // translated code already names the class of failure.
              <p
                className="ml-4 break-words text-muted-foreground"
                data-testid="chat-message-error-detail"
              >
                {message.errorMessage}
              </p>
            )}
          </div>
        )}

        {/* Legacy fallback: when `segments` isn't set (early P5 chats,
            tests that build messages without going through appendChunk)
            render the tool-call list below the body the way P5 did. The
            AssistantBody above already handles segment-based rendering
            when segments IS set, so we skip the legacy list there. */}
        {!isUser &&
          !message.segments &&
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

    // P6 polish — interleaved rendering. When the manager populated
    // `segments`, walk them in emission order so a "text → tool calls
    // → more text" turn renders top-to-bottom in that order instead
    // of dumping all tool cards under the concatenated text.
    if (message.segments && message.segments.length > 0) {
      const toolCallsById = new Map<string, ToolInvocation>(
        (message.toolCalls ?? []).map((tc) => [tc.toolCallId, tc]),
      );
      return (
        <div className="space-y-1" data-testid="assistant-segments">
          {message.segments.map((seg, idx) => {
            if (seg.type === 'text') {
              if (!seg.text) return null;
              return (
                <MarkdownText
                  key={`text-${idx}`}
                  text={seg.text}
                  renderer={renderer}
                />
              );
            }
            const tc = toolCallsById.get(seg.toolCallId);
            if (!tc) return null;
            return <ToolCallCard key={seg.toolCallId} invocation={tc} />;
          })}
        </div>
      );
    }

    // Legacy / fallback path — no segments populated (test fixtures
    // that build a message directly with just `content`, or messages
    // restored from pre-P6 sessions). Render the concatenated content
    // as one markdown block.
    if (!message.content) return null;
    return <MarkdownText text={message.content} renderer={renderer} />;
  },
);
AssistantBody.displayName = 'AssistantBody';

const MarkdownText: React.FC<{
  text: string;
  renderer: MarkdownRenderer | null;
}> = ({ text, renderer }) => {
  const html = React.useMemo(() => {
    if (!text) return '';
    if (!renderer) {
      return `<p style="white-space: pre-wrap">${escapeHtml(text)}</p>`;
    }
    return renderer(text);
  }, [text, renderer]);
  return (
    <div
      // Selectors keep markdown content from busting the bubble's
      // `max-w-[85%]`:
      //   - `break-words` + `[&_code]:break-words` wrap long URLs /
      //     inline tokens at character boundaries when needed.
      //   - `[&_pre]:overflow-x-auto [&_pre]:max-w-full` gives code
      //     blocks a horizontal scrollbar instead of expanding the
      //     bubble.
      //   - `[&_table]:block` + overflow-x-auto does the same for
      //     wide markdown tables.
      className="prose prose-sm dark:prose-invert max-w-none break-words [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_p]:my-1 [&_code]:break-words [&_a]:break-words [&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

/* -------------------------------------------------------------------- */
/*  ThinkingIndicator — "Thinking…" gerund that rotates while streaming   */
/* -------------------------------------------------------------------- */

/**
 * Replaces the bare pulsing dot with a playful rotating gerund so the
 * user has something to read while the assistant is preparing its
 * first chunk. The dot stays for visual continuity. The gerund list is
 * sourced from i18n (`assistant-chat:thinking_gerunds`, pipe-separated)
 * so translators can substitute equivalents.
 *
 * Rotation cadence is intentionally just slow enough to read (~2.2s) —
 * faster than that and it feels jittery on a freshly-opened stream
 * that lands its first chunk inside ~500ms.
 */
const THINKING_ROTATION_MS = 2200;

const ThinkingIndicator: React.FC = () => {
  const { t } = useTranslation();
  const gerunds = React.useMemo(() => {
    const raw = t('assistant-chat:thinking_gerunds');
    const parts = raw
      .split('|')
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
    // Fallback when the locale key is missing or empty — avoids ever
    // rendering an empty span.
    return parts.length > 0 ? parts : ['Thinking'];
  }, [t]);
  const [idx, setIdx] = React.useState(() =>
    Math.floor(Math.random() * gerunds.length),
  );
  React.useEffect(() => {
    if (gerunds.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((prev) => {
        // Always pick a different word so the same gerund doesn't
        // appear to "hang" between ticks.
        const next = Math.floor(Math.random() * (gerunds.length - 1));
        return next >= prev ? next + 1 : next;
      });
    }, THINKING_ROTATION_MS);
    return () => window.clearInterval(id);
  }, [gerunds.length]);
  return (
    <span
      className="inline-flex items-center gap-2 text-xs italic text-muted-foreground"
      data-testid="thinking-indicator"
    >
      <span
        className="streaming-dot inline-block h-2 w-2 animate-pulse rounded-full bg-current"
        aria-hidden="true"
      />
      <span aria-live="polite" aria-label={t('assistant-chat:streaming')}>
        {gerunds[idx]}…
      </span>
    </span>
  );
};

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
