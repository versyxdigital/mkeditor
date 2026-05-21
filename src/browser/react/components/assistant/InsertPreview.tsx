import * as React from 'react';

import { useTranslation } from '../../hooks/useTranslation';

/**
 * Single-block preview for tools whose intent is pure addition —
 * `insert_at_cursor` (content inserted into an existing file) and
 * `create_file` (content of a new file). No diff semantics: there is
 * no "before" to compare against, so a Monaco diff editor would just
 * render the entire payload as a single green chunk anyway. Using a
 * lightweight `<pre>` keeps the inline tool card cheap to mount and
 * matches the existing modal's after-block styling.
 *
 * The "show full" truncation expander lives one phase later — for now
 * the caller hands in the (possibly-truncated) string the manager
 * already produced via `AssistantTools.buildPreview()`.
 */
export interface InsertPreviewProps {
  /** The text to be inserted / written. */
  content: string;
  /** Optional descriptive line — line range / insertion point. */
  detail?: string;
  /**
   * Pixel cap on the scrollable block. Default 240px so the chat
   * card stays bounded; longer content gets a vertical scrollbar
   * inside the block (the surrounding card never grows).
   */
  maxHeight?: number;
}

export const InsertPreview: React.FC<InsertPreviewProps> = ({
  content,
  detail,
  maxHeight = 240,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className="rounded border border-border bg-background"
      data-testid="insert-preview"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs">
        <span className="font-semibold">
          {t('assistant-tools:preview_after')}
        </span>
        {detail ? (
          <span className="text-muted-foreground">{detail}</span>
        ) : null}
      </div>
      <pre
        className="overflow-auto bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        {content}
      </pre>
    </div>
  );
};
