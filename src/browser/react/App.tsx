import * as React from 'react';
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type PanelImperativeHandle,
} from 'react-resizable-panels';

import { ManagersProvider, type Managers } from './contexts/ManagersContext';
import { UIStateProvider, useUIState } from './contexts/UIStateContext';
import { FilesProvider } from './contexts/FilesContext';
import { FileTreeProvider } from './contexts/FileTreeContext';
import { LegacyShell } from './components/LegacyShell';
import { Navbar } from './components/Navbar';
import { TabBar } from './components/TabBar';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './components/Workspace';
import { EditorToolbar } from './components/EditorToolbar';

import './styles/tailwind.css';

export interface AppProps {
  initialManagers: Managers;
  initialSidebarOpen: boolean;
  /** Fires once after Monaco is created (forwarded from <EditorHost>). */
  onEditorReady?: () => void;
  /**
   * Composition root receives this on first render and uses it to push an
   * updated managers object after `BridgeManager` (and therefore
   * `FileManager` / `FileTreeManager`) are constructed inside
   * `onEditorReady`. Without this, `FilesContext` would never see a
   * non-null fileManager.
   */
  registerSetManagers?: (
    setter: React.Dispatch<React.SetStateAction<Managers>>,
  ) => void;
}

export const App: React.FC<AppProps> = ({
  initialManagers,
  initialSidebarOpen,
  onEditorReady,
  registerSetManagers,
}) => {
  const [managers, setManagers] = React.useState<Managers>(initialManagers);

  // Hand the setter to the composition root during the first render — i.e.
  // before any child effect runs (in particular <EditorHost>'s useEffect,
  // which triggers onEditorReady and thus setReactManagers). Child effects
  // fire before parent effects, so a useEffect here would be too late.
  // useRef + a one-shot guard is the React-canonical pattern for "run
  // exactly once during the initial render".
  const registeredRef = React.useRef(false);
  if (!registeredRef.current) {
    registeredRef.current = true;
    registerSetManagers?.(setManagers);
  }

  // Shared ref to the editor/preview Group so <EditorToolbar>'s
  // split-reset button can call setLayout directly (no legacy DOM bridge).
  const workspaceGroupRef = React.useRef<GroupImperativeHandle>(null);

  return (
    <ManagersProvider value={managers}>
      <UIStateProvider initialSidebarOpen={initialSidebarOpen}>
        <FilesProvider>
          <FileTreeProvider>
            <LegacyShell />
            <Navbar />
            <TabBar />
            <Shell
              onEditorReady={onEditorReady}
              workspaceGroupRef={workspaceGroupRef}
            />
            <EditorToolbar workspaceGroupRef={workspaceGroupRef} />
          </FileTreeProvider>
        </FilesProvider>
      </UIStateProvider>
    </ManagersProvider>
  );
};

/**
 * Sidebar | Workspace split. The outer Group sits below the Navbar +
 * TabBar in #react-root's flex column and flex-grows to fill the
 * remaining vertical space (`#mkeditor-layout { flex: 1 }`).
 */
const Shell: React.FC<{
  onEditorReady?: () => void;
  workspaceGroupRef: React.RefObject<GroupImperativeHandle | null>;
}> = ({ onEditorReady, workspaceGroupRef }) => {
  const { sidebarOpen } = useUIState();
  const sidebarPanelRef = React.useRef<PanelImperativeHandle>(null);

  React.useEffect(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (sidebarOpen && panel.isCollapsed()) panel.expand();
    else if (!sidebarOpen && !panel.isCollapsed()) panel.collapse();
  }, [sidebarOpen]);

  return (
    <Group orientation="horizontal" id="mkeditor-layout">
      <Panel
        id="sidebar-pane"
        panelRef={sidebarPanelRef}
        collapsible
        defaultSize="15%"
        minSize="10%"
      >
        <Sidebar />
      </Panel>
      <Separator className="gutter sidebar-gutter-horizontal" />
      <Panel id="workspace-pane">
        <Workspace groupRef={workspaceGroupRef} onEditorReady={onEditorReady} />
      </Panel>
    </Group>
  );
};
