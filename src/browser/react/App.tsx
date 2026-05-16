import * as React from 'react';
import {
  Group,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from 'react-resizable-panels';

import { ManagersProvider, type Managers } from './contexts/ManagersContext';
import { UIStateProvider, useUIState } from './contexts/UIStateContext';
import { LegacyShell } from './components/LegacyShell';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './components/Workspace';

import './styles/tailwind.css';

export interface AppProps {
  managers: Managers;
  initialSidebarOpen: boolean;
  /** Fires once after Monaco is created (forwarded from <EditorHost>). */
  onEditorReady?: () => void;
}

export const App: React.FC<AppProps> = ({
  managers,
  initialSidebarOpen,
  onEditorReady,
}) => (
  <ManagersProvider value={managers}>
    <UIStateProvider initialSidebarOpen={initialSidebarOpen}>
      <LegacyShell />
      <Shell onEditorReady={onEditorReady} />
    </UIStateProvider>
  </ManagersProvider>
);

/**
 * Outer two-panel layout: collapsible sidebar | workspace. The sidebar
 * Panel is driven imperatively from `useUIState().sidebarOpen` so the
 * legacy `#sidebar-toggle` button (still rendered by the static HTML
 * shell until Phase 4 owns the navbar) toggles a context value rather
 * than mutating classes directly.
 */
const Shell: React.FC<{ onEditorReady?: () => void }> = ({ onEditorReady }) => {
  const { sidebarOpen, toggleSidebar } = useUIState();
  const sidebarPanelRef = React.useRef<PanelImperativeHandle>(null);

  // Bridge legacy #sidebar-toggle (Phase 4 will own the navbar in React).
  React.useEffect(() => {
    const btn = document.getElementById('sidebar-toggle');
    if (!btn) return;
    btn.addEventListener('click', toggleSidebar);
    return () => btn.removeEventListener('click', toggleSidebar);
  }, [toggleSidebar]);

  // Mirror UIStateContext.sidebarOpen into the panel's collapsed/expanded
  // state. Runs on every change AND once on mount, so an `initialSidebarOpen
  // === false` (web mode) collapses the sidebar before the user sees it.
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
        <Workspace onEditorReady={onEditorReady} />
      </Panel>
    </Group>
  );
};
