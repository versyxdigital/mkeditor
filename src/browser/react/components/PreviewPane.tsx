import * as React from 'react';

import { refreshLines } from '../../extensions/editor/ScrollSync';
import { useManagers } from '../contexts/ManagersContext';

// Markdown.ts pulls in markdown-it, KaTeX, highlight.js core + 13
// language modules — ~400 KB of code that isn't needed until the
// preview renders its first frame. Dynamic-import it once on mount
// so it lands in a separate chunk and stays out of the main bundle.
type MarkdownAPI = typeof import('../../core/Markdown').Markdown;
let markdownPromise: Promise<MarkdownAPI> | null = null;
function loadMarkdown(): Promise<MarkdownAPI> {
  if (!markdownPromise) {
    markdownPromise = import('../../core/Markdown').then((m) => m.Markdown);
  }
  return markdownPromise;
}

/**
 * Renders the markdown preview. Subscribes to `editor:render`; on each
 * event runs `Markdown.render(editorManager.getValue())` and writes the
 * result into `#preview-content`. The innerHTML write is intentional:
 * markdown-it produces HTML strings (see HTMLExporter risk note).
 *
 * Refs:
 * - Outer `#preview` div is read by ScrollSync via `dom.preview.wrapper`.
 * - Inner `#preview-content` div is read by HTMLExporter via
 *   `dom.preview.dom.outerHTML` and by ExportSettingsProvider for live
 *   styling. Both dom.ts getters re-query at access time, so they pick
 *   up these React-rendered elements once they mount.
 */
export const PreviewPane: React.FC = () => {
  const { editorManager, dispatcher } = useManagers();
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let cancelled = false;
    let md: MarkdownAPI | null = null;

    const render = () => {
      if (!contentRef.current || !md) return;
      contentRef.current.innerHTML = md.render(editorManager?.getValue() ?? '');
      refreshLines();
    };

    // Load Markdown once, then wire up the render handler. While the
    // chunk is in flight, any editor:render dispatches are silently
    // dropped — the catch-up `render()` call after the load handles
    // the initial state, and subsequent edits stay within the editor's
    // debounce window so nothing visible is lost.
    void loadMarkdown().then((api) => {
      if (cancelled) return;
      md = api;
      render();
    });

    dispatcher.addEventListener('editor:render', render);
    return () => {
      cancelled = true;
      dispatcher.removeEventListener('editor:render', render);
    };
  }, [dispatcher, editorManager]);

  return (
    <div id="preview" className="flex flex-col split-preview p-3">
      <div ref={contentRef} id="preview-content" className="container-fluid" />
    </div>
  );
};
