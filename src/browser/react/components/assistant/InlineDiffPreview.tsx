import * as React from 'react';
import { editor } from 'monaco-editor';

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
}

export const InlineDiffPreview: React.FC<InlineDiffPreviewProps> = ({
  original,
  modified,
  language = 'markdown',
  height = 240,
}) => {
  const { settings } = useSettings();
  const { t } = useTranslation();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const diffEditorRef = React.useRef<editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = React.useRef<editor.ITextModel | null>(null);
  const modifiedModelRef = React.useRef<editor.ITextModel | null>(null);
  const [sideBySide, setSideBySide] = React.useState(false);

  // Mount + dispose. One-shot effect with [] deps so we don't recreate
  // the diff editor on every prop change — the data-update effect
  // below mutates models in place instead.
  React.useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const originalModel = editor.createModel(original, language);
    const modifiedModel = editor.createModel(modified, language);
    originalModelRef.current = originalModel;
    modifiedModelRef.current = modifiedModel;
    const diff = editor.createDiffEditor(host, {
      renderSideBySide: false,
      readOnly: true,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      lineNumbers: 'on',
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
      // still references throws inside Monaco's internals (the same
      // class of "Cannot read properties of undefined (_isDisposed)"
      // crash the workspace-switch close hit).
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
    // Intentionally one-shot — see comment block above.
  }, []);

  // Push prop changes into the existing models via setValue. Cheap;
  // avoids remounting the editor when the user clicks Accept on one
  // confirmation card and the next one renders in the same DOM slot.
  React.useEffect(() => {
    const om = originalModelRef.current;
    if (om && om.getValue() !== original) om.setValue(original);
    const mm = modifiedModelRef.current;
    if (mm && mm.getValue() !== modified) mm.setValue(modified);
  }, [original, modified]);

  // Side-by-side toggle is a hot option — updateOptions, no remount.
  React.useEffect(() => {
    diffEditorRef.current?.updateOptions({ renderSideBySide: sideBySide });
  }, [sideBySide]);

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
      <div className="absolute right-1 top-1 z-10">
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
      <div
        ref={containerRef}
        style={{ height: `${height}px`, width: '100%' }}
      />
    </div>
  );
};
