import * as React from 'react';

import type {
  PendingConfirm,
  ToolInvocation,
} from '../../../../app/interfaces/Assistant';
import { useAssistantChat } from '../../contexts/AssistantContext';
import { useManagers } from '../../contexts/ManagersContext';
import { useTranslation } from '../../hooks/useTranslation';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Icon } from '../Icon';
import { InlineDiffPreview } from './InlineDiffPreview';
import { InsertPreview } from './InsertPreview';

/**
 * Inline collapsible card for a single `ToolInvocation`. Rendered
 * below the assistant message text by `<ChatMessage>`.
 *
 * States (`invocation.status`):
 *   - `pending-confirm`: waiting on the user (the confirm dialog is
 *     open elsewhere). Small muted card with a "waiting" hint.
 *   - `executing`: tool is running. Animated dot, no expand affordance.
 *   - `succeeded`: collapsed by default; expandable to show args + the
 *     returned result (serialised JSON, truncated to a reasonable
 *     height).
 *   - `failed`: red border + error code + expandable detail.
 *
 * Stateless — `<ChatPane>` re-renders us each chunk via the manager's
 * snapshot, so the visual updates automatically as the status flows
 * through the lifecycle.
 */
/** Character threshold above which the result `<pre>` collapses behind a "Show more" toggle. */
const RESULT_TRUNCATE_AT = 1000;

export const ToolCallCard: React.FC<{ invocation: ToolInvocation }> = ({
  invocation,
}) => {
  const { t } = useTranslation();
  const { chat, manager } = useAssistantChat();
  const [expanded, setExpanded] = React.useState(false);
  const [resultExpanded, setResultExpanded] = React.useState(false);

  const stateClass = STATUS_CLASS[invocation.status];

  // "Retry" button on a failed card. The original SDK loop has long
  // since closed, so retry isn't an SDK-level replay; we pipeline a
  // fresh user-facing turn that prompts the agent to try again. The
  // agent sees the previous failed tool-call card in the conversation
  // history (failed tool calls stay visible) and can choose how to
  // recover.
  const handleRetry = React.useCallback(() => {
    if (!manager) return;
    const activeProvider = chat.activeProvider;
    if (!activeProvider) return;
    const conversationId = chat.activeConversation[activeProvider];
    if (!conversationId) return;
    const argsRendered = (() => {
      try {
        return JSON.stringify(invocation.arguments);
      } catch {
        return '';
      }
    })();
    const prompt = argsRendered
      ? t('assistant-tools:retry_prompt_with_args', {
          toolName: invocation.toolName,
          args: argsRendered,
        })
      : t('assistant-tools:retry_prompt', {
          toolName: invocation.toolName,
        });
    manager.startCall(activeProvider, conversationId, prompt);
  }, [manager, chat, invocation, t]);

  // Inline confirmation card: rendered above the standard expand row
  // when this tool is awaiting the user's OK AND the manager has
  // surfaced the preview in `chat.pendingConfirms`. The modal opens
  // alongside; whichever the user interacts with first wins (manager
  // dismisses the other via the race-resolution in `runWithConfirmation`).
  const pending: PendingConfirm | undefined =
    invocation.status === 'pending-confirm'
      ? chat.pendingConfirms[invocation.toolCallId]
      : undefined;

  return (
    <div
      data-testid={`tool-call-${invocation.toolCallId}`}
      data-status={invocation.status}
      className={cn('mt-2 rounded border px-2 py-1.5 text-xs', stateClass)}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={expanded}
        aria-label={t('assistant-tools:toggle_card', {
          toolName: invocation.toolName,
        })}
      >
        <Icon
          name={expanded ? 'chevron-down' : 'chevron-right'}
          className="text-xs"
        />
        <span className="font-mono text-xs">{invocation.toolName}</span>
        <span className="ml-auto flex items-center gap-1 text-xs">
          <StatusBadge status={invocation.status} />
        </span>
      </button>

      {pending && (
        <InlineConfirm
          invocation={invocation}
          pending={pending}
          onRespond={(ok) =>
            manager?.respondToConfirm(invocation.toolCallId, ok)
          }
        />
      )}

      {expanded && (
        <div className="mt-2 flex flex-col gap-2 border-t border-current/20 pt-2">
          <div>
            <p className="text-xs font-semibold opacity-80">
              {t('assistant-tools:args_label')}
            </p>
            <pre className="max-h-32 overflow-auto rounded border border-current/20 bg-background/40 p-1.5 text-xs">
              {JSON.stringify(invocation.arguments, null, 2)}
            </pre>
          </div>
          {invocation.status === 'succeeded' &&
            invocation.result !== undefined && (
              <ResultBlock
                resultText={formatResult(invocation.result)}
                expanded={resultExpanded}
                onToggle={() => setResultExpanded((v) => !v)}
              />
            )}
          {invocation.status === 'failed' && (
            <div>
              <p className="text-xs font-semibold opacity-80">
                {t('assistant-tools:error_label')}
              </p>
              <p className="text-xs">
                {t(
                  `assistant-tools:error_${invocation.errorCode ?? 'execution_failed'}`,
                )}
                {invocation.errorMessage ? ` — ${invocation.errorMessage}` : ''}
              </p>
              {/* Retry affordance: fires a new chat turn that
                  prompts the agent to try the call again. Disabled
                  when the chat is mid-stream (a tool-call retry
                  collides with whatever's currently streaming). */}
              <button
                type="button"
                onClick={handleRetry}
                disabled={!manager || Object.keys(chat.inflight).length > 0}
                className="mt-1 inline-flex items-center gap-1 rounded border border-current/30 px-2 py-0.5 text-xs hover:bg-current/10 disabled:opacity-50"
                data-testid={`tool-call-retry-${invocation.toolCallId}`}
              >
                <Icon name="refresh" />
                <span>{t('assistant-tools:retry')}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------- */
/*  Inline confirmation card                                            */
/* -------------------------------------------------------------------- */

/**
 * Inline tool-confirmation surface — Monaco diff (for write / edit /
 * replace) or single-block (for insert / create) above a sticky Accept
 * / Reject footer. The modal version of this card (`<ConfirmToolCall>`)
 * still opens in parallel as a fallback; the manager races the two,
 * dismissing the loser.
 */
const InlineConfirm: React.FC<{
  invocation: ToolInvocation;
  pending: PendingConfirm;
  onRespond: (ok: boolean) => void;
}> = ({ invocation, pending, onRespond }) => {
  const { t } = useTranslation();
  const { fileManager } = useManagers();
  const { manager } = useAssistantChat();
  const { preview } = pending;
  const { diffProps, blockProps } = useInlineConfirmContent(
    invocation,
    preview,
    manager,
  );

  // Pop-out handler: lifts the currently-visible diff content out of
  // the chat card and into a real editor tab via FileManager. The
  // tab id is keyed off `toolCallId` so re-clicking pop-out for the
  // same tool just re-focuses the existing tab (openDiffTab handles
  // the upsert). Disabled (handler undefined) for non-diff previews
  // — the InsertPreview component doesn't take an onPopOut.
  const popOut = React.useCallback(
    (current: { original: string; modified: string }) => {
      if (!fileManager) return;
      const path = preview?.path;
      const baseName = path
        ? (path.split(/[\\/]/).pop() ?? path)
        : invocation.toolName;
      fileManager.openDiffTab({
        id: `diff://${invocation.toolCallId}`,
        name: `Δ ${baseName}`,
        original: current.original,
        modified: current.modified,
        language: 'markdown',
        sourcePath: path,
      });
    },
    [fileManager, invocation.toolCallId, invocation.toolName, preview?.path],
  );

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-current/20 pt-2">
      {preview && preview.path ? (
        <p className="text-xs font-semibold opacity-80">
          {t(PREVIEW_KIND_LABEL[preview.kind], { path: preview.path })}
          {preview.detail ? ` · ${preview.detail}` : ''}
        </p>
      ) : null}
      {diffProps ? (
        <InlineDiffPreview
          {...diffProps}
          onPopOut={fileManager ? popOut : undefined}
        />
      ) : blockProps ? (
        <InsertPreview {...blockProps} />
      ) : null}
      {/* Sticky footer — Accept / Reject. Stays visible even when the
          diff editor scrolls inside its own height cap. */}
      <div className="sticky bottom-0 -mx-2 flex items-center justify-end gap-2 border-t border-current/20 bg-inherit px-2 py-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onRespond(false)}
          data-testid={`tool-call-reject-${invocation.toolCallId}`}
        >
          {t('assistant-tools:confirm_reject')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="default"
          onClick={() => onRespond(true)}
          data-testid={`tool-call-accept-${invocation.toolCallId}`}
        >
          {t('assistant-tools:confirm_accept')}
        </Button>
      </div>
    </div>
  );
};

const PREVIEW_KIND_LABEL: Record<
  NonNullable<PendingConfirm['preview']>['kind'],
  string
> = {
  create: 'assistant-tools:preview_create',
  write: 'assistant-tools:preview_write',
  edit: 'assistant-tools:preview_edit',
  replace: 'assistant-tools:preview_replace',
  insert: 'assistant-tools:preview_insert',
};

/**
 * Per-preview-kind table of which sides are expandable through the
 * "Show full" button. The expansion itself lives in
 * `AssistantManager.getFullPreviewContent` (which delegates to the
 * tool's `getFullContent` in `AssistantTools.ts`); the renderer only
 * needs to know whether to surface a button per side. Keeping the
 * file-IO and EOL-normalisation logic on the manager side means the
 * expanded preview agrees with what the tool actually writes — and
 * keeps `window.mked.readFile` out of React.
 */
const EXPANDABLE_SIDES: Record<
  NonNullable<PendingConfirm['preview']>['kind'],
  { before: boolean; after: boolean }
> = {
  write: { before: true, after: true },
  edit: { before: true, after: true },
  replace: { before: false, after: true },
  create: { before: false, after: true },
  insert: { before: false, after: true },
};

/**
 * Compute the props for `<InlineDiffPreview>` or `<InsertPreview>`
 * based on the tool's kind. The "Show full" fetchers all route
 * through `manager.getFullPreviewContent(toolCallId, side)` — the
 * React layer never touches `window.mked` directly. When `manager`
 * is null (initial mount before composition root wires it) the
 * fetchers are omitted entirely so no expander button appears.
 */
function useInlineConfirmContent(
  invocation: ToolInvocation,
  preview: PendingConfirm['preview'],
  manager: import('../../../core/AssistantManager').AssistantManager | null,
): {
  diffProps?: React.ComponentProps<typeof InlineDiffPreview>;
  blockProps?: React.ComponentProps<typeof InsertPreview>;
} {
  return React.useMemo(() => {
    if (!preview) return {};
    const expandable = EXPANDABLE_SIDES[preview.kind];
    const buildFetcher = (
      side: 'before' | 'after',
    ): (() => Promise<string>) | undefined => {
      if (!manager) return undefined;
      if (!expandable[side]) return undefined;
      return async () => {
        const content = await manager.getFullPreviewContent(
          invocation.toolCallId,
          side,
        );
        if (content === undefined) {
          // The tool's `getFullContent` returned no content for this
          // side (no executor wired, or — more commonly — the
          // confirmation already resolved out from under us). Throw
          // so the hook surfaces a Retry affordance instead of
          // silently swapping in empty content.
          throw new Error('Full content unavailable.');
        }
        return content;
      };
    };
    if (preview.kind === 'insert' || preview.kind === 'create') {
      return {
        blockProps: {
          content: preview.after,
          detail: preview.detail,
          fetchFull: buildFetcher('after'),
        },
      };
    }
    return {
      diffProps: {
        original: preview.before ?? '',
        modified: preview.after,
        fetchFullOriginal: buildFetcher('before'),
        fetchFullModified: buildFetcher('after'),
      },
    };
  }, [invocation.toolCallId, preview, manager]);
}

const StatusBadge: React.FC<{ status: ToolInvocation['status'] }> = ({
  status,
}) => {
  const { t } = useTranslation();
  if (status === 'executing') {
    return (
      <span
        aria-label={t('assistant-tools:status_executing')}
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current"
      />
    );
  }
  return <span>{t(`assistant-tools:status_${status}`)}</span>;
};

const STATUS_CLASS: Record<ToolInvocation['status'], string> = {
  'pending-confirm':
    'border-amber-400/40 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200',
  executing: 'border-border bg-muted text-foreground',
  succeeded:
    'border-emerald-400/40 bg-emerald-50 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-200',
  failed:
    'border-red-400/40 bg-red-50 text-red-900 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-200',
};

function formatResult(result: unknown): string {
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/**
 * Result `<pre>` with a P8 "Show more" toggle. Short results render
 * uncapped; long ones (>RESULT_TRUNCATE_AT chars) collapse to the
 * leading slice plus a count-aware "Show more" button. Click expands;
 * a second click re-collapses. Keeps a long agent stdout from
 * dominating the chat scroll.
 */
const ResultBlock: React.FC<{
  resultText: string;
  expanded: boolean;
  onToggle: () => void;
}> = ({ resultText, expanded, onToggle }) => {
  const { t } = useTranslation();
  const truncated = resultText.length > RESULT_TRUNCATE_AT && !expanded;
  const shown = truncated
    ? resultText.slice(0, RESULT_TRUNCATE_AT)
    : resultText;
  const hiddenChars = truncated ? resultText.length - RESULT_TRUNCATE_AT : 0;
  return (
    <div>
      <p className="text-xs font-semibold opacity-80">
        {t('assistant-tools:result_label')}
      </p>
      <pre
        className={cn(
          'overflow-auto rounded border border-current/20 bg-background/40 p-1.5 text-xs',
          // Cap height only while truncated — once the user clicks
          // "Show more" they want to read the whole thing.
          truncated && 'max-h-40',
          expanded && 'max-h-96',
        )}
      >
        {shown}
        {truncated ? '\n…' : ''}
      </pre>
      {(truncated || expanded) && resultText.length > RESULT_TRUNCATE_AT && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-1 text-xs underline opacity-80 hover:opacity-100"
          data-testid="tool-result-toggle"
        >
          {truncated
            ? t('assistant-tools:show_more', { chars: hiddenChars })
            : t('assistant-tools:show_less')}
        </button>
      )}
    </div>
  );
};
