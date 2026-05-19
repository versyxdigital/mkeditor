import * as React from 'react';

import type { ToolInvocation } from '../../../../app/interfaces/Assistant';
import { useAssistantChat } from '../../contexts/AssistantContext';
import { useTranslation } from '../../hooks/useTranslation';
import { cn } from '../../lib/utils';
import { Icon } from '../Icon';

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
