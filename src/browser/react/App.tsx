import * as React from 'react';
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type PanelImperativeHandle,
  type PanelSize,
} from 'react-resizable-panels';
import { Toaster } from 'sonner';

import {
  ManagersProvider,
  useManagers,
  type Managers,
} from './contexts/ManagersContext';
import {
  UIStateProvider,
  toggleRightSidebarExternal,
  useUIState,
} from './contexts/UIStateContext';
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
  ToolConfirmProvider,
  registerToolConfirmCanceller,
  registerToolConfirmOpener,
  registerToolConfirmToolCallCanceller,
  useToolConfirm,
} from './contexts/ToolConfirmContext';
import {
  PropertiesProvider,
  registerPropertiesShower,
  useProperties,
} from './contexts/PropertiesContext';
import { SettingsContextProvider } from './contexts/SettingsContext';
import { ExportSettingsContextProvider } from './contexts/ExportSettingsContext';
import { AssistantContextProvider } from './contexts/AssistantContext';
import { Navbar } from './components/Navbar';
import { TabBar } from './components/TabBar';
import { TitleBar } from './components/TitleBar';
import { AssistantSidebar } from './components/AssistantSidebar';
import { ConfirmToolCall } from './components/assistant/ConfirmToolCall';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './components/Workspace';
import { EditorToolbar } from './components/EditorToolbar';
import { BottomToolbarRight } from './components/BottomToolbarRight';
import { WindowProvider } from './contexts/WindowContext';
import { registerMenuActionDispatcher } from '../menuDispatch';
import type { MenuAction } from '../../app/lib/menuModel';
import type { ModalKey } from './contexts/ModalsContext';

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
          <AssistantContextProvider>
            <ModalsProvider>
              <PromptsProvider>
                <PropertiesProvider>
                  <WindowProvider>
                    <ToolConfirmProvider>
                      <ModalsBridge />
                      <PromptsBridge />
                      <PropertiesBridge />
                      <MenuActionBridge />
                      <ToolConfirmBridge />
                      <UIStateProvider initialSidebarOpen={initialSidebarOpen}>
                        <FilesProvider>
                          <FileTreeProvider>
                            <TitleBar />
                            <Navbar />
                            <TabBar />
                            <Shell
                              onEditorReady={onEditorReady}
                              workspaceGroupRef={workspaceGroupRef}
                            />
                            <EditorToolbar
                              workspaceGroupRef={workspaceGroupRef}
                            />
                            <BottomToolbarRight />
                            <LazyModals />
                            <ConfirmToolCall />
                            <Toaster
                              position="bottom-right"
                              richColors
                              closeButton
                              theme="system"
                            />
                          </FileTreeProvider>
                        </FilesProvider>
                      </UIStateProvider>
                    </ToolConfirmProvider>
                  </WindowProvider>
                </PropertiesProvider>
              </PromptsProvider>
            </ModalsProvider>
          </AssistantContextProvider>
        </ExportSettingsContextProvider>
      </SettingsContextProvider>
    </ManagersProvider>
  );
};

/**
 * Resolves a `MenuAction` from the in-window `<TitleBar>` into the right
 * effect — modals, Monaco commands, BridgeManager helpers, or main-process
 * IPC. Registered through `menuDispatch.ts` so the non-React TitleBar.menu
 * component can fire actions through a stable module-level seam.
 */
const MenuActionBridge: React.FC = () => {
  const { bridgeManager, editorManager } = useManagers();
  const { openModal } = useModals();

  const dispatch = React.useCallback(
    (action: MenuAction) => {
      switch (action.kind) {
        case 'channel': {
          const editor = editorManager?.getMkEditor() ?? null;
          if (action.channel === 'from:modal:open') {
            // Payload may be a bare modal key OR `{modal, tab?}` for
            // the P8 Help → Configure AI Providers menu item that
            // opens Settings on a specific tab.
            const payload = action.payload as
              | ModalKey
              | { modal: ModalKey; tab?: 'general' | 'assistant' };
            if (typeof payload === 'string') {
              openModal(payload);
            } else if (payload && typeof payload.modal === 'string') {
              openModal(
                payload.modal,
                payload.tab ? { tab: payload.tab } : undefined,
              );
            }
            return;
          }
          if (action.channel === 'from:assistant:toggle') {
            // View → Toggle Assistant Sidebar (also fired from
            // the system tray on desktop). Route through the same
            // UIStateContext seam BridgeListeners uses for the
            // main-process / native macOS menu firing.
            toggleRightSidebarExternal();
            return;
          }
          if (action.channel === 'from:command:palette') {
            if (editor) {
              setTimeout(() => {
                editor.focus();
                editor.trigger('open', 'editor.action.quickCommand', {});
              });
            }
            return;
          }
          // Other channels map 1-1 to a BridgeManager helper.
          if (!bridgeManager) return;
          switch (action.channel) {
            case 'from:file:new':
              return bridgeManager.menuFileNew();
            case 'from:file:open':
              return bridgeManager.menuFileOpen();
            case 'from:file:save':
              return bridgeManager.menuFileSave();
            case 'from:file:saveas':
              return bridgeManager.menuFileSaveAs();
            case 'from:folder:open':
              return bridgeManager.menuFolderOpen();
          }
          return;
        }
        case 'role': {
          const editor = editorManager?.getMkEditor() ?? null;
          switch (action.role) {
            case 'undo':
              editor?.trigger('keyboard', 'undo', null);
              return;
            case 'redo':
              editor?.trigger('keyboard', 'redo', null);
              return;
            case 'cut':
              if (editor && bridgeManager) {
                setTimeout(() => {
                  editor.focus();
                  bridgeManager.editCut();
                });
              }
              return;
            case 'copy':
              if (editor && bridgeManager) {
                setTimeout(() => {
                  editor.focus();
                  bridgeManager.editCopy();
                });
              }
              return;
            case 'paste':
              if (editor && bridgeManager) {
                setTimeout(() => {
                  editor.focus();
                  bridgeManager.editPaste();
                });
              }
              return;
            case 'togglefullscreen':
              bridgeManager?.windowToggleFullscreen();
              return;
            case 'quit':
              bridgeManager?.windowClose();
              return;
          }
          return;
        }
        case 'command':
          bridgeManager?.runCommand(action.commandId);
          return;
      }
    },
    [bridgeManager, editorManager, openModal],
  );

  React.useEffect(() => {
    registerMenuActionDispatcher(dispatch);
  }, [dispatch]);

  return null;
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
 * Hands the `useToolConfirm().open` function (and its sibling
 * `cancelForCallId`) to the module-level seam so
 * `AssistantManager.runWithConfirmation` and `cancelCall` (non-React
 * callers) can drive the dialog without importing React.
 */
const ToolConfirmBridge: React.FC = () => {
  const { open, cancelForCallId, cancelForToolCallId } = useToolConfirm();
  React.useEffect(() => {
    registerToolConfirmOpener(open);
    registerToolConfirmCanceller(cancelForCallId);
    registerToolConfirmToolCallCanceller(cancelForToolCallId);
  }, [open, cancelForCallId, cancelForToolCallId]);
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
    setSeen((prev) => (prev.properties ? prev : { ...prev, properties: true }));
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
 * Sidebar | Workspace | AssistantSidebar split. The outer Group sits
 * below the Navbar + TabBar in #react-root's flex column and flex-grows
 * to fill the remaining vertical space (`#mkeditor-layout { flex: 1 }`).
 *
 * The right-hand `assistant-pane` mirrors the left sidebar's
 * collapse/expand effect. Its size is read from + written to
 * UIStateContext and persisted through the session payload so
 * `{ open, size }` survives relaunch.
 */
export const Shell: React.FC<{
  onEditorReady?: () => void;
  workspaceGroupRef: React.RefObject<GroupImperativeHandle | null>;
}> = ({ onEditorReady, workspaceGroupRef }) => {
  const {
    sidebarOpen,
    rightSidebarOpen,
    rightSidebarSize,
    setRightSidebarSize,
  } = useUIState();
  const { mode } = useManagers();
  // AI Assistant is desktop-only. On web the assistant pane is not
  // rendered at all — see the Decisions table in
  // docs/AI_ASSISTANT.md for the rationale (no localStorage key
  // storage, no in-renderer SDK path).
  const showAssistant = mode !== 'web';
  const sidebarPanelRef = React.useRef<PanelImperativeHandle>(null);
  const assistantPanelRef = React.useRef<PanelImperativeHandle>(null);

  React.useEffect(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (sidebarOpen && panel.isCollapsed()) panel.expand();
    else if (!sidebarOpen && !panel.isCollapsed()) panel.collapse();
  }, [sidebarOpen]);

  React.useEffect(() => {
    if (!showAssistant) return;
    const panel = assistantPanelRef.current;
    if (!panel) return;
    if (rightSidebarOpen && panel.isCollapsed()) panel.expand();
    else if (!rightSidebarOpen && !panel.isCollapsed()) panel.collapse();
  }, [rightSidebarOpen, showAssistant]);

  // Push every drag tick into UIStateContext so the size persists
  // through the session save pipeline (debounced 300ms by
  // FileManager.scheduleSessionSave). The panel reports size as a
  // percentage of the outer Group, matching how we persist it. We
  // suppress zero-size events fired while the panel is collapsed so
  // collapsing doesn't clobber the user's last-chosen expanded size.
  const handleAssistantResize = React.useCallback(
    (panelSize: PanelSize) => {
      const size = panelSize.asPercentage;
      if (size > 0 && size !== rightSidebarSize) {
        setRightSidebarSize(size);
      }
    },
    [rightSidebarSize, setRightSidebarSize],
  );

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
      {showAssistant && (
        <>
          <Separator className="gutter sidebar-gutter-horizontal" />
          <Panel
            id="assistant-pane"
            panelRef={assistantPanelRef}
            collapsible
            defaultSize={`${rightSidebarSize}%`}
            minSize="15%"
            onResize={handleAssistantResize}
          >
            <AssistantSidebar />
          </Panel>
        </>
      )}
    </Group>
  );
};
