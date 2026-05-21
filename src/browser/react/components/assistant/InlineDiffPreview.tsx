import * as React from 'react';
import { editor } from 'monaco-editor';

import { PREVIEW_TRUNCATION_MARKER } from '../../../core/AssistantTools';
import { useSettings } from '../../contexts/SettingsContext';
import { useTranslation } from '../../hooks/useTranslation';
import { Button } from '../ui/button';
import { Icon } from '../Icon';

/**
 * Inline Monaco diff preview surfaced inside `<ToolCallCard>` when a
 * write-class tool is awaiting confirmation. Defaults to unified
 * rendering (one column, inline +/- chunks) — fits the narrow chat
 * panel cleanly. A toggle button flips into Monaco's side-by-side
 * mode for users who want the old two-pane layout.
 *
 * Lifecycle:
 *   - On mount, create two throwaway `ITextModel`s (`original` /
 *     `modified`) and a `IStandaloneDiffEditor`. Wire them once;
 *     subsequent prop changes reuse the same editor and call
 *     `setValue` on the models so the diff updates in place without
 *     a remount (Monaco recovers cleanly from `setValue` but does
 *     NOT recover from `setModel(disposed)`).
 *   - On unmount, dispose the editor first, then both models.
 *     Disposing the editor while it's still attached to disposed
 *     models throws "Cannot read properties of undefined" — the
 *     pattern is editor-first.
 *
 * The toggle calls `updateOptions({ renderSideBySide })` — no remount
 * needed.
 *
 * Theme tracks the user's `effectiveDarkmode` setting via SettingsContext.
 */
export interface InlineDiffPreviewProps {
  /** "Before" content. Empty string for pure-insertion previews. */
  original: string;
  /** "After" content. */
  modified: string;
  /** Monaco language id (default `'markdown'`). */
  language?: string;
  /**
   * Pixel height of the diff editor. Default 240px keeps narrow chat
   * panels usable; callers can pass a smaller value for tight tool
   * cards.
   */
  height?: number;
  /**
   * Returns the untruncated `original`. Required only when `original`
   * ends with the truncation marker — when supplied alongside its
   * `modified` counterpart, a single "show full" button appears in
   * the header and fetches both sides in parallel.
   */
  fetchFullOriginal?: () => Promise<string>;
  /** Returns the untruncated `modified`. */
  fetchFullModified?: () => Promise<string>;
}

export const InlineDiffPreview: React.FC<InlineDiffPreviewProps> = ({
  original,
  modified,
  language = 'markdown',
  height = 240,
  fetchFullOriginal,
  fetchFullModified,
}) => {
  const { settings } = useSettings();
  const { t } = useTranslation();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const diffEditorRef = React.useRef<editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = React.useRef<editor.ITextModel | null>(null);
  const modifiedModelRef = React.useRef<editor.ITextModel | null>(null);
  const [sideBySide, setSideBySide] = React.useState(false);

  // Truncation-expander state. The diff editor takes two correlated
  // streams, so we coordinate a single expand/collapse for the pair
  // rather than letting each side toggle independently (which would
  // produce a diff between two contents-from-different-eras and
  // surface meaningless +/- chunks).
  const originalTruncated = original.endsWith(PREVIEW_TRUNCATION_MARKER);
  const modifiedTruncated = modified.endsWith(PREVIEW_TRUNCATION_MARKER);
  const canExpand =
    (originalTruncated && fetchFullOriginal !== undefined) ||
    (modifiedTruncated && fetchFullModified !== undefined);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isExpandLoading, setIsExpandLoading] = React.useState(false);
  const [expandError, setExpandError] = React.useState<string | null>(null);
  const [fullOriginal, setFullOriginal] = React.useState<string | null>(null);
  const [fullModified, setFullModified] = React.useState<string | null>(null);

  // Reset cached full content + collapse when the source pair changes.
  // Without this, swapping to a different tool's preview would keep
  // showing the previous tool's expanded content.
  React.useEffect(() => {
    setIsExpanded(false);
    setIsExpandLoading(false);
    setExpandError(null);
    setFullOriginal(null);
    setFullModified(null);
  }, [original, modified]);

  // What actually flows into Monaco's models.
  const effectiveOriginal =
    isExpanded && fullOriginal !== null ? fullOriginal : original;
  const effectiveModified =
    isExpanded && fullModified !== null ? fullModified : modified;

  const toggleExpand = React.useCallback(() => {
    if (!canExpand) return;
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }
    if (fullOriginal !== null && fullModified !== null) {
      setIsExpanded(true);
      setExpandError(null);
      return;
    }
    setIsExpandLoading(true);
    setExpandError(null);
    const origPromise =
      originalTruncated && fetchFullOriginal && fullOriginal === null
        ? fetchFullOriginal()
        : Promise.resolve(fullOriginal ?? original);
    const modPromise =
      modifiedTruncated && fetchFullModified && fullModified === null
        ? fetchFullModified()
        : Promise.resolve(fullModified ?? modified);
    void Promise.all([origPromise, modPromise])
      .then(([origRes, modRes]) => {
        setFullOriginal(origRes);
        setFullModified(modRes);
        setIsExpanded(true);
        setIsExpandLoading(false);
      })
      .catch((err: unknown) => {
        setExpandError(err instanceof Error ? err.message : String(err));
        setIsExpandLoading(false);
      });
    // No AbortController — same rationale as `useExpandableContent`:
    // these are one-shot IPC round-trips and the wasted bytes on
    // cancel are negligible. React 18 swallows setState on unmounted
    // components safely.
  }, [
    canExpand,
    isExpanded,
    fullOriginal,
    fullModified,
    original,
    modified,
    originalTruncated,
    modifiedTruncated,
    fetchFullOriginal,
    fetchFullModified,
  ]);

  // Editor + model lifecycle. Recreates on side-by-side toggle
  // because Monaco 0.55's `IDiffEditor.updateOptions({renderSideBySide})`
  // doesn't reliably flip the render mode at runtime in our embedded
  // usage — the editor honours the value supplied at
  // `createDiffEditor` time. Bundled with model creation in a single
  // effect so the cleanup function disposes the editor BEFORE the
  // models in one pass (React unwinds effect cleanups in declaration
  // order, so splitting model/editor into separate effects would
  // dispose models first — the same "Cannot read properties of
  // undefined (_isDisposed)" Monaco crash the workspace-switch close
  // path hit).
  //
  // Content updates flow through the data-sync effect below (setValue
  // on the existing models), so prop changes between toggles don't
  // remount the editor.
  React.useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    // Initialise with the EFFECTIVE values so a toggle after the user
    // clicked "Show full" doesn't revert to the truncated content.
    const originalModel = editor.createModel(effectiveOriginal, language);
    const modifiedModel = editor.createModel(effectiveModified, language);
    originalModelRef.current = originalModel;
    modifiedModelRef.current = modifiedModel;
    const diff = editor.createDiffEditor(host, {
      renderSideBySide: sideBySide,
      readOnly: true,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      // Line numbers are noise inside a narrow chat panel — the diff's
      // `detail` line already carries "Lines X–Y" for context-bounded
      // previews. Killing them reclaims ~50px of horizontal space
      // (default `lineNumbersMinChars: 5` × two columns in unified
      // mode + indicator gutter).
      lineNumbers: 'off',
      glyphMargin: false,
      folding: false,
      wordWrap: 'on',
      renderOverviewRuler: false,
      // Hide the per-pane scrollbars in unified mode where they cause
      // double-scrollbar noise; the inline diff fits the chat panel
      // better without them.
      scrollbar: { vertical: 'auto', horizontal: 'hidden' },
    });
    diff.setModel({ original: originalModel, modified: modifiedModel });
    diffEditorRef.current = diff;
    return () => {
      // Editor first, then models — disposing a model that an editor
      // still references throws inside Monaco's internals.
      try {
        diff.dispose();
      } catch {
        // already-disposed; nothing to do
      }
      try {
        originalModel.dispose();
      } catch {
        // already-disposed; nothing to do
      }
      try {
        modifiedModel.dispose();
      } catch {
        // already-disposed; nothing to do
      }
      diffEditorRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
    // Intentionally only depending on `sideBySide` — content changes
    // flow through setValue in the data-sync effect below to avoid
    // recreating the editor on every prop change.
  }, [sideBySide]);

  // Push effective content into the existing models via setValue.
  // Cheap; avoids remounting the editor when the user clicks Accept
  // on one confirmation card and the next one renders in the same
  // DOM slot, OR when the truncation expander flips between the
  // capped and full content.
  React.useEffect(() => {
    const om = originalModelRef.current;
    if (om && om.getValue() !== effectiveOriginal)
      om.setValue(effectiveOriginal);
    const mm = modifiedModelRef.current;
    if (mm && mm.getValue() !== effectiveModified)
      mm.setValue(effectiveModified);
  }, [effectiveOriginal, effectiveModified]);

  // Theme follows the effective rendered theme (NOT the stored
  // preference) so the diff matches the surrounding editor when
  // systemtheme is following a contrary OS.
  React.useEffect(() => {
    editor.setTheme(settings.effectiveDarkmode ? 'vs-dark' : 'vs');
  }, [settings.effectiveDarkmode]);

  return (
    <div
      className="relative rounded border border-border bg-background"
      data-testid="inline-diff-preview"
    >
      <div className="absolute right-1 top-1 z-10 flex items-center gap-1">
        {canExpand && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={toggleExpand}
            disabled={isExpandLoading}
            data-testid="inline-diff-expand-toggle"
            title={
              expandError
                ? expandError
                : isExpandLoading
                  ? t('assistant-tools:preview_loading')
                  : isExpanded
                    ? t('assistant-tools:preview_show_less')
                    : t('assistant-tools:preview_show_full')
            }
          >
            {isExpandLoading
              ? t('assistant-tools:preview_loading')
              : isExpanded
                ? t('assistant-tools:preview_show_less')
                : expandError
                  ? t('assistant-tools:preview_retry')
                  : t('assistant-tools:preview_show_full')}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => setSideBySide((v) => !v)}
          aria-pressed={sideBySide}
          data-testid="inline-diff-side-by-side-toggle"
          title={t(
            sideBySide
              ? 'assistant-tools:diff_view_unified'
              : 'assistant-tools:diff_view_side_by_side',
          )}
        >
          {/* Icon hints the TARGET mode (what clicking switches TO),
              matching the title text below. */}
          <Icon name={sideBySide ? 'list-ul' : 'table-columns'} />
        </Button>
      </div>
      {/* `key` flips on the side-by-side toggle so React tears down
          the old container DOM and mounts a fresh one. Without this,
          Monaco's `createDiffEditor` is called on the same div the
          previous (now-disposed) editor left behind, and the new
          render mode doesn't visually apply — even though the
          createDiffEditor call carries the correct `renderSideBySide`.
          The fresh container guarantees Monaco gets a clean canvas. */}
      <div
        key={`diff-host-${sideBySide ? 'sbs' : 'unified'}`}
        ref={containerRef}
        style={{ height: `${height}px`, width: '100%' }}
      />
    </div>
  );
};
