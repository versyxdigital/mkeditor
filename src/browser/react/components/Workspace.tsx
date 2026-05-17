import * as React from 'react';
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
} from 'react-resizable-panels';

import { useManagers } from '../contexts/ManagersContext';
import { EditorHost } from './EditorHost';
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
      <Panel id="editor-pane" onResize={() => editorManager?.layout()}>
        <EditorHost onReady={onEditorReady} />
      </Panel>
      <Separator className="gutter gutter-horizontal" />
      <Panel id="preview-pane">
        <PreviewPane />
      </Panel>
    </Group>
  );
};
