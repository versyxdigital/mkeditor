import * as React from 'react';

import { useFiles } from '../contexts/FilesContext';
import { useManagers } from '../contexts/ManagersContext';
import { InlineDiffPreview } from './assistant/InlineDiffPreview';

/**
 * Read-only diff view shown in the editor pane when the user pops a
 * tool-confirmation diff out of the chat sidebar into a real tab.
 * Mounts as a sibling of `<EditorHost>` inside the editor `<Panel>`;
 * the pane has `position: relative` so this overlay can absolute-fill
 * it. Monaco stays mounted beneath but invisible — when the user
 * activates a regular file tab again, the overlay unmounts and
 * Monaco's editor is back in view without losing its model state.
 *
 * Payload is read from `fileManager.getDiffTab(activeFile)`. The
 * matching `TabInfo` (`kind: 'diff'`) lives in `tabs` and shows up
 * in the tab strip as a regular tab; closing it goes through
 * `closeTab` which detects the kind and skips the unsaved-changes
 * prompt.
 */
export const EditorPaneDiffOverlay: React.FC = () => {
  const { fileManager } = useManagers();
  const { tabs, activeFile } = useFiles();

  const activeTab = activeFile
    ? tabs.find((t) => t.path === activeFile)
    : undefined;
  const isDiff = activeTab?.kind === 'diff';

  // Read the payload synchronously (no subscribe — diff payloads are
  // immutable once created). When the user activates a different tab
  // this overlay unmounts so we never carry stale data.
  const payload =
    isDiff && fileManager && activeFile
      ? fileManager.getDiffTab(activeFile)
      : undefined;

  if (!isDiff || !payload) return null;
  return (
    <div
      // Absolute-fill the editor pane. The pane has `overflow: hidden`
      // and (after this commit) `position: relative` so this overlay
      // covers Monaco exactly.
      className="absolute inset-0 z-10"
      data-testid="editor-pane-diff-overlay"
    >
      <InlineDiffPreview
        original={payload.original}
        modified={payload.modified}
        language={payload.language ?? 'markdown'}
        fill
      />
    </div>
  );
};
