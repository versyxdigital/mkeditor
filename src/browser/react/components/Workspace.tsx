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
  onEditorReady?: () => void;
}

/**
 * The editor/preview split. Replaces split.js for this gutter using
 * `react-resizable-panels` v4 (Group + Panel + Separator). Panel.onResize
 * fires `editorManager.layout()` so Monaco reflows on every drag tick.
 *
 * A `useEffect` bridges the legacy `#split-reset` toolbar button: clicks
 * call `group.setLayout({ editor: 50, preview: 50 })`. Phase 6 will move
 * the button itself into React when the toolbar is refactored.
 */
export const Workspace: React.FC<WorkspaceProps> = ({ onEditorReady }) => {
  const { editorManager } = useManagers();
  const groupRef = React.useRef<GroupImperativeHandle>(null);

  React.useEffect(() => {
    const btn = document.getElementById('split-reset');
    if (!btn) return;
    const reset = () =>
      groupRef.current?.setLayout({
        'editor-pane': 50,
        'preview-pane': 50,
      });
    btn.addEventListener('click', reset);
    return () => btn.removeEventListener('click', reset);
  }, []);

  return (
    <Group orientation="horizontal" id="editor-preview" groupRef={groupRef}>
      <Panel id="editor-pane" onResize={() => editorManager.layout()}>
        <EditorHost onReady={onEditorReady} />
      </Panel>
      <Separator className="gutter gutter-horizontal" />
      <Panel id="preview-pane">
        <PreviewPane />
      </Panel>
    </Group>
  );
};
