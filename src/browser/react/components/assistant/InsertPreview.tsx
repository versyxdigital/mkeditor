import * as React from 'react';

import { useExpandableContent } from '../../hooks/useExpandableContent';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/button';

/**
 * Single-block preview for tools whose intent is pure addition —
 * `insert_at_cursor` (content inserted into an existing file) and
 * `create_file` (content of a new file). No diff semantics: there is
 * no "before" to compare against, so a Monaco diff editor would just
 * render the entire payload as a single green chunk anyway. Using a
 * lightweight `<pre>` keeps the inline tool card cheap to mount and
 * matches the existing modal's after-block styling.
 *
 * When the preview content was truncated (the manager caps at
 * `PREVIEW_TRUNCATE_AT` chars and appends `PREVIEW_TRUNCATION_MARKER`),
 * a "show full" button appears below the block. Clicking it awaits
 * `fetchFull()` for the untruncated string and swaps the visible
 * content in place. Tools where the full content is already in the
 * snapshot (e.g. `args.content`) hand in a synchronous fetcher; tools
 * that need a disk read use `mked:fs:readfile` via the bridge.
 */
export interface InsertPreviewProps {
  /** The (possibly-truncated) text to be inserted / written. */
  content: string;
  /** Optional descriptive line — line range / insertion point. */
  detail?: string;
  /**
   * Pixel cap on the scrollable block. Default 240px so the chat
   * card stays bounded; longer content gets a vertical scrollbar
   * inside the block (the surrounding card never grows).
   */
  maxHeight?: number;
  /**
   * Returns the untruncated content. Required when `content` ends
   * with the truncation marker; ignored otherwise. The component
   * doesn't try to derive the full content itself — the caller
   * owns the source (tool args, disk read, etc.).
   */
  fetchFull?: () => Promise<string>;
}

export const InsertPreview: React.FC<InsertPreviewProps> = ({
  content,
  detail,
  maxHeight = 240,
  fetchFull,
}) => {
  const { t } = useTranslation();
  // Stable no-op fetcher so the hook always has something to call.
  // When `content` isn't truncated the hook never invokes it anyway,
  // and when it is truncated but no fetcher was provided we treat
  // the cap as final (show no expander).
  const fetcher = React.useMemo(
    () => fetchFull ?? (() => Promise.resolve(content)),
    [fetchFull, content],
  );
  const {
    content: visible,
    isTruncated,
    isExpanded,
    isLoading,
    error,
    toggle,
  } = useExpandableContent(content, fetcher);
  const showExpander = isTruncated && fetchFull !== undefined;

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
        {visible}
      </pre>
      {showExpander && (
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-xs">
          {error ? (
            <span
              className="text-destructive"
              data-testid="insert-preview-error"
            >
              {error}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {isExpanded ? null : t('assistant-tools:preview_truncated_hint')}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={toggle}
            disabled={isLoading}
            data-testid="insert-preview-toggle"
          >
            {isLoading
              ? t('assistant-tools:preview_loading')
              : isExpanded
                ? t('assistant-tools:preview_show_less')
                : error
                  ? t('assistant-tools:preview_retry')
                  : t('assistant-tools:preview_show_full')}
          </Button>
        </div>
      )}
    </div>
  );
};
