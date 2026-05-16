import * as React from 'react';

import { Markdown } from '../../core/Markdown';
import { refreshLines } from '../../extensions/editor/ScrollSync';
import { useManagers } from '../contexts/ManagersContext';

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
    const handler = () => {
      if (!contentRef.current) return;
      contentRef.current.innerHTML = Markdown.render(editorManager.getValue());
      refreshLines();
    };
    dispatcher.addEventListener('editor:render', handler);
    // Catch-up: if EditorHost's useEffect already created Monaco and
    // dispatched its initial render before this effect ran, the
    // synchronous call here renders the current content immediately.
    handler();
    return () => dispatcher.removeEventListener('editor:render', handler);
  }, [dispatcher, editorManager]);

  return (
    <div id="preview" className="flex flex-col split-preview p-3">
      <div ref={contentRef} id="preview-content" className="container-fluid" />
    </div>
  );
};
