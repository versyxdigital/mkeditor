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
 *   - `executing`: tool is running, with a pulsing status indicator.
 *   - `succeeded`: collapsed by default; expandable to show args + the
 *     returned result, with wrapping text and expandable excerpts.
 *   - `failed`: error status + error code + expandable detail.
 *
 * The manager owns execution state; local state only controls disclosure.
 */
/** Bound initial excerpts by both characters and lines, without nested scrolling. */
const RESULT_TRUNCATE_AT = 1000;
const PREVIEW_LINES = 18;

export const ToolCallCard: React.FC<{ invocation: ToolInvocation }> = ({
  invocation,
}) => {
  const { t } = useTranslation();
  const { chat, manager } = useAssistantChat();
  const [expanded, setExpanded] = React.useState(false);
  const [resultExpanded, setResultExpanded] = React.useState(false);
  const [argsExpanded, setArgsExpanded] = React.useState(false);
  const detailsId = React.useId();
  const args = invocation.arguments;
  const path =
    args &&
    typeof args === 'object' &&
    'path' in args &&
    typeof args.path === 'string'
      ? args.path
      : undefined;

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
      className="mt-2 min-w-0 max-w-full rounded-lg border border-border bg-editor text-xs text-foreground"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-expanded={expanded}
        aria-controls={detailsId}
        aria-label={t('assistant-tools:toggle_card', {
          toolName: invocation.toolName,
        })}
      >
        <Icon name="terminal" className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className="truncate font-mono text-xs font-medium"
            title={invocation.toolName}
          >
            {invocation.toolName}
          </span>
          {path && (
            <span
              className="truncate text-[11px] text-muted-foreground"
              title={path}
            >
              {path}
            </span>
          )}
        </span>
        <span className="ml-auto shrink-0 text-[11px]">
          <StatusBadge status={invocation.status} />
        </span>
        <Icon
          name={expanded ? 'chevron-down' : 'chevron-right'}
          className="h-2.5 w-2.5 text-muted-foreground"
        />
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
        <div
          id={detailsId}
          className="flex min-w-0 flex-col gap-3 border-t border-subtle p-3"
        >
          <ToolTextBlock
            label={t('assistant-tools:args_label')}
            text={formatResult(invocation.arguments)}
            expanded={argsExpanded}
            onToggle={() => setArgsExpanded((v) => !v)}
            testId="tool-args-toggle"
          />
          {invocation.status === 'succeeded' &&
            invocation.result !== undefined && (
              <ToolTextBlock
                label={t('assistant-tools:result_label')}
                text={formatResult(invocation.result)}
                expanded={resultExpanded}
                onToggle={() => setResultExpanded((v) => !v)}
                testId="tool-result-toggle"
              />
            )}
          {invocation.status === 'failed' && (
            <div className="rounded-md bg-destructive/10 p-3 text-destructive [overflow-wrap:anywhere]">
              <p className="mb-1 text-[11px] font-medium">
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
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRetry}
                disabled={!manager || Object.keys(chat.inflight).length > 0}
                className="mt-2 gap-1"
                data-testid={`tool-call-retry-${invocation.toolCallId}`}
              >
                <Icon name="refresh" />
                <span>{t('assistant-tools:retry')}</span>
              </Button>
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
    <div className="mx-3 flex min-w-0 flex-col gap-3 border-t border-subtle pt-3">
      {preview && (preview.path || preview.summary) ? (
        <p className="break-all text-xs font-medium text-muted-foreground">
          {preview.summary ??
            t(PREVIEW_KIND_LABEL[preview.kind], { path: preview.path })}
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
      <div className="sticky bottom-0 -mx-3 flex items-center justify-end gap-2 rounded-b-lg border-t border-subtle bg-editor px-3 py-2">
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
  operation: 'assistant-tools:preview_write',
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
  operation: { before: false, after: false },
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
    if (!preview || preview.kind === 'operation') return {};
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
        className="inline-flex items-center gap-1.5 text-muted-foreground"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
        {t('assistant-tools:status_executing')}
      </span>
    );
  }
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', STATUS_COLOR[status])}
    >
      <Icon
        name={status === 'succeeded' ? 'check' : 'exclamation-circle'}
        className="h-3 w-3"
      />
      {t(`assistant-tools:status_${status}`)}
    </span>
  );
};

const STATUS_COLOR: Record<ToolInvocation['status'], string> = {
  'pending-confirm': 'text-warning',
  executing: 'text-muted-foreground',
  succeeded: 'text-success',
  failed: 'text-destructive',
};

function formatResult(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2) ?? String(result);
  } catch {
    return String(result);
  }
}

/**
 * Arguments/results wrap within the card and use the chat's own scroll.
 * Large payloads start as bounded excerpts; expanding reveals the full
 * text without clipping or adding a nested scroll region.
 */
const ToolTextBlock: React.FC<{
  label: string;
  text: string;
  expanded: boolean;
  onToggle: () => void;
  testId: string;
}> = ({ label, text, expanded, onToggle, testId }) => {
  const { t } = useTranslation();
  const contentId = React.useId();
  const excerpt = text
    .slice(0, RESULT_TRUNCATE_AT)
    .split('\n', PREVIEW_LINES + 1)
    .slice(0, PREVIEW_LINES)
    .join('\n');
  const canExpand = excerpt.length < text.length;
  const truncated = canExpand && !expanded;
  const shown = truncated ? excerpt : text;
  const hiddenChars = text.length - excerpt.length;
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
        {label}
      </p>
      <pre
        id={contentId}
        className="m-0 min-w-0 whitespace-pre-wrap rounded-md bg-sidebar px-3 py-2 font-mono text-[11px] leading-5 text-foreground [overflow-wrap:anywhere]"
      >
        {shown}
        {truncated ? '\n…' : ''}
      </pre>
      {canExpand && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggle}
          className="mt-1 h-6 px-2 text-xs text-muted-foreground"
          data-testid={testId}
          aria-expanded={expanded}
          aria-controls={contentId}
        >
          {truncated
            ? t('assistant-tools:show_more', { chars: hiddenChars })
            : t('assistant-tools:show_less')}
        </Button>
      )}
    </div>
  );
};
