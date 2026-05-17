import * as React from 'react';
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type PanelImperativeHandle,
} from 'react-resizable-panels';
import { Toaster } from 'sonner';

import { ManagersProvider, type Managers } from './contexts/ManagersContext';
import { UIStateProvider, useUIState } from './contexts/UIStateContext';
import { FilesProvider } from './contexts/FilesContext';
import { FileTreeProvider } from './contexts/FileTreeContext';
import {
  ModalsProvider,
  registerOpenModal,
  useModals,
} from './contexts/ModalsContext';
import {
  PromptsProvider,
  registerPromptOpener,
  usePrompts,
} from './contexts/PromptsContext';
import {
  PropertiesProvider,
  registerPropertiesShower,
  useProperties,
} from './contexts/PropertiesContext';
import { SettingsContextProvider } from './contexts/SettingsContext';
import { ExportSettingsContextProvider } from './contexts/ExportSettingsContext';
import { Navbar } from './components/Navbar';
import { TabBar } from './components/TabBar';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './components/Workspace';
import { EditorToolbar } from './components/EditorToolbar';
import { BottomToolbarRight } from './components/BottomToolbarRight';

// Modals are lazy: each one is a separate webpack chunk that is only
// fetched the first time the user opens it. The five modal components
// pull in shadcn primitives (Switch, Select, Checkbox, locale list,
// shortcut tables, FileProperties formatting) that aren't needed for
// initial paint — keeping them out of the main bundle is a measurable
// startup win. See `<LazyModals>` below for the mount strategy that
// preserves Radix's close-animation by keeping each modal mounted
// once it has been opened for the first time.
const SettingsModal = React.lazy(() =>
  import('./components/modals/SettingsModal').then((m) => ({
    default: m.SettingsModal,
  })),
);
const ExportSettingsModal = React.lazy(() =>
  import('./components/modals/ExportSettingsModal').then((m) => ({
    default: m.ExportSettingsModal,
  })),
);
const AboutModal = React.lazy(() =>
  import('./components/modals/AboutModal').then((m) => ({
    default: m.AboutModal,
  })),
);
const ShortcutsModal = React.lazy(() =>
  import('./components/modals/ShortcutsModal').then((m) => ({
    default: m.ShortcutsModal,
  })),
);
const PropertiesModal = React.lazy(() =>
  import('./components/modals/PropertiesModal').then((m) => ({
    default: m.PropertiesModal,
  })),
);

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
      <SettingsContextProvider>
        <ExportSettingsContextProvider>
          <ModalsProvider>
            <PromptsProvider>
              <PropertiesProvider>
                <ModalsBridge />
                <PromptsBridge />
                <PropertiesBridge />
                <UIStateProvider initialSidebarOpen={initialSidebarOpen}>
                  <FilesProvider>
                    <FileTreeProvider>
                      <Navbar />
                      <TabBar />
                      <Shell
                        onEditorReady={onEditorReady}
                        workspaceGroupRef={workspaceGroupRef}
                      />
                      <EditorToolbar workspaceGroupRef={workspaceGroupRef} />
                      <BottomToolbarRight />
                      <LazyModals />
                      <Toaster
                        position="bottom-right"
                        richColors
                        closeButton
                        theme="system"
                      />
                    </FileTreeProvider>
                  </FilesProvider>
                </UIStateProvider>
              </PropertiesProvider>
            </PromptsProvider>
          </ModalsProvider>
        </ExportSettingsContextProvider>
      </SettingsContextProvider>
    </ManagersProvider>
  );
};

/**
 * Registers ModalsContext's `openModal` with the module-level setter that
 * non-React callers (BridgeListeners' `from:modal:open`, CommandProvider's
 * keybindings) invoke via `openModalExternal`. Renders nothing.
 */
const ModalsBridge: React.FC = () => {
  const { openModal } = useModals();
  React.useEffect(() => {
    registerOpenModal(openModal);
  }, [openModal]);
  return null;
};

/**
 * Hands the `usePrompts().open` function to the module-level
 * `openPromptExternal` so non-React callers (FileManager.closeTab and
 * the explorer context-menu actions) can open a prompt and await the
 * user's response.
 */
const PromptsBridge: React.FC = () => {
  const { open } = usePrompts();
  React.useEffect(() => {
    registerPromptOpener(open);
  }, [open]);
  return null;
};

/**
 * Hands the `useProperties().show` function to the module-level
 * `showPropertiesExternal` so BridgeListeners' `from:path:properties`
 * handler can pop the modal.
 */
const PropertiesBridge: React.FC = () => {
  const { show } = useProperties();
  React.useEffect(() => {
    registerPropertiesShower(show);
  }, [show]);
  return null;
};

/**
 * Lazy-mount the five Dialog-based modals.
 *
 * Strategy: track which modals have *ever* been opened in this session
 * and only render those. Each one's React.lazy chunk loads the first
 * time the user triggers it, then stays mounted afterward so Radix's
 * close-animation plays normally. Modals the user never touches never
 * load at all — Shortcuts/About/Properties are common no-ops.
 */
const LazyModals: React.FC = () => {
  const { open } = useModals();
  const { info: propertiesInfo } = useProperties();

  const [seen, setSeen] = React.useState({
    settings: false,
    exportSettings: false,
    about: false,
    shortcuts: false,
    properties: false,
  });

  React.useEffect(() => {
    if (!open) return;
    setSeen((prev) => (prev[open] ? prev : { ...prev, [open]: true }));
  }, [open]);

  React.useEffect(() => {
    if (!propertiesInfo) return;
    setSeen((prev) =>
      prev.properties ? prev : { ...prev, properties: true },
    );
  }, [propertiesInfo]);

  return (
    <React.Suspense fallback={null}>
      {seen.settings && <SettingsModal />}
      {seen.exportSettings && <ExportSettingsModal />}
      {seen.about && <AboutModal />}
      {seen.shortcuts && <ShortcutsModal />}
      {seen.properties && <PropertiesModal />}
    </React.Suspense>
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
