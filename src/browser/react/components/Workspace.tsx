import * as React from 'react';
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
} from 'react-resizable-panels';

import { useManagers } from '../contexts/ManagersContext';
import { EditorHost } from './EditorHost';
import { EditorPaneDiffOverlay } from './EditorPaneDiffOverlay';
import { PreviewPane } from './PreviewPane';

interface WorkspaceProps {
  /** Shared ref owned by <App>; <EditorToolbar>'s split-reset button calls
   * `groupRef.current.setLayout({...})` directly via the same ref. */
  groupRef: React.Ref<GroupImperativeHandle | null>;
  onEditorReady?: () => void;
}

/**
 * The editor/preview split. Using `react-resizable-panels` v4
 * (Group + Panel + Separator). Panel.onResize fires
 * `editorManager.layout()` so Monaco reflows on every drag tick.
 *
 * React `<EditorToolbar>` owns the split-reset button and calls
 * `groupRef.current.setLayout(...)` directly through the ref that <App>
 * passes here.
 */
export const Workspace: React.FC<WorkspaceProps> = ({
  groupRef,
  onEditorReady,
}) => {
  const { editorManager } = useManagers();

  return (
    <Group orientation="horizontal" id="editor-preview" groupRef={groupRef}>
      <Panel
        id="editor-pane"
        onResize={() => editorManager?.layout()}
        // `react-resizable-panels` v4 puts an inner `<div>` with inline
        // `overflow: auto` around the panel children. Monaco owns its own
        // scrollbars, so leaving that div scrollable lets the two compete:
        // on smaller viewports the pane jumps as both fight to keep the
        // cursor in view. Forcing `overflow: hidden` cedes scrolling to
        // Monaco entirely.
        style={{ overflow: 'hidden' }}
      >
        {/* `position: relative` anchor for the diff overlay below.
            The overlay absolute-fills this wrapper when the active
            tab is a popped-out diff; otherwise it returns null and
            Monaco renders unobstructed. */}
        <div className="relative h-full w-full">
          <EditorHost onReady={onEditorReady} />
          <EditorPaneDiffOverlay />
        </div>
      </Panel>
      <Separator className="gutter gutter-horizontal" />
      <Panel id="preview-pane">
        <PreviewPane />
      </Panel>
    </Group>
  );
};
