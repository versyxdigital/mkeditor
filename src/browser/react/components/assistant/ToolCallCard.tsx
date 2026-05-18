import * as React from 'react';

import type { ToolInvocation } from '../../../../app/interfaces/Assistant';
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
export const ToolCallCard: React.FC<{ invocation: ToolInvocation }> = ({
  invocation,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = React.useState(false);

  const stateClass = STATUS_CLASS[invocation.status];

  return (
    <div
      data-testid={`tool-call-${invocation.toolCallId}`}
      data-status={invocation.status}
      className={cn(
        'mt-2 rounded border px-2 py-1.5 text-xs',
        stateClass,
      )}
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
              <div>
                <p className="text-xs font-semibold opacity-80">
                  {t('assistant-tools:result_label')}
                </p>
                <pre className="max-h-40 overflow-auto rounded border border-current/20 bg-background/40 p-1.5 text-xs">
                  {formatResult(invocation.result)}
                </pre>
              </div>
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
                {invocation.errorMessage
                  ? ` — ${invocation.errorMessage}`
                  : ''}
              </p>
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
