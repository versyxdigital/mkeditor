import * as React from 'react';

import { PREVIEW_TRUNCATION_MARKER } from '../../core/AssistantTools';

/**
 * Shared expand/collapse state for a truncated preview string.
 *
 * `AssistantTools.buildPreview()` caps every `before` / `after` at
 * `PREVIEW_TRUNCATE_AT` chars and appends `PREVIEW_TRUNCATION_MARKER`
 * to signal the cut. The inline tool card shows a "show full" button
 * when the marker is present; clicking it awaits `fetcher()` for the
 * untruncated string and re-renders with that.
 *
 * For most tools the fetcher resolves synchronously off `toolCall.arguments`
 * (the agent's full proposal is already in the snapshot). For tools where
 * `before` came from disk (`write_file`'s open-file content), the fetcher
 * does an `mked:fs:readfile` round-trip — same trust boundary AssistantContextSource uses for read-class tool reads.
 */
export interface UseExpandableContentResult {
  /** Content to display — truncated until expanded, full after. */
  content: string;
  /** True iff the initial content ends with the truncation marker. */
  isTruncated: boolean;
  /** True iff the user clicked "show full" and the fetch succeeded. */
  isExpanded: boolean;
  /** True between the click and the fetcher's resolution. */
  isLoading: boolean;
  /**
   * Error message if the fetcher rejected. The button switches to a
   * "Retry" affordance; the truncated content stays visible.
   */
  error: string | null;
  /** Toggle between truncated and expanded. */
  toggle: () => void;
}

export function useExpandableContent(
  initialContent: string,
  fetcher: () => Promise<string>,
): UseExpandableContentResult {
  const isTruncated = React.useMemo(
    () => initialContent.endsWith(PREVIEW_TRUNCATION_MARKER),
    [initialContent],
  );
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fullContent, setFullContent] = React.useState<string | null>(null);

  // Reset when the initial content changes (e.g. one card's
  // confirmation accepted, the next tool's preview lands in the same
  // DOM slot). Otherwise we'd keep showing the previous tool's full
  // content over the new tool's truncated head.
  React.useEffect(() => {
    setIsExpanded(false);
    setIsLoading(false);
    setError(null);
    setFullContent(null);
  }, [initialContent]);

  // Hold the fetcher in a ref so callers don't need to memoise it.
  // The toggle handler reads the latest fetcher at call time; we
  // don't re-trigger any effects when the fetcher identity changes.
  const fetcherRef = React.useRef(fetcher);
  React.useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const toggle = React.useCallback(() => {
    if (!isTruncated) return;
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }
    if (fullContent !== null) {
      // Already fetched once this mount — re-expand instantly without
      // a second round-trip.
      setIsExpanded(true);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    void fetcherRef
      .current()
      .then((full) => {
        setFullContent(full);
        setIsExpanded(true);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setIsLoading(false);
      });
    // No AbortController — these are one-shot IPC round-trips and the
    // wasted bytes if the component unmounts mid-fetch are negligible.
    // React 18 swallows setState on unmounted components safely.
  }, [isTruncated, isExpanded, fullContent]);

  const content =
    isExpanded && fullContent !== null ? fullContent : initialContent;

  return { content, isTruncated, isExpanded, isLoading, error, toggle };
}
