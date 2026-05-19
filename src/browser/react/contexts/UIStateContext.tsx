import * as React from 'react';
import type { AssistantViewState } from '../../interfaces/Session';
import {
  _setRestoreHandler,
  _syncMirror,
  _notifyAssistantStateChange,
  applyRestoredAssistantState,
  clearAssistantStateChangeListener,
  getCurrentAssistantState,
  registerAssistantStateChangeListener,
  registerToggleRightSidebar,
  toggleRightSidebarExternal,
} from '../../assistantUiState';

// Re-export the public seam surface so existing React-side / test
// imports keep working. The seam itself lives at
// `src/browser/assistantUiState.ts` (outside `react/`) so managers
// can use it without importing React — see the comment at the top
// of that file.
export {
  applyRestoredAssistantState,
  clearAssistantStateChangeListener,
  getCurrentAssistantState,
  registerAssistantStateChangeListener,
  registerToggleRightSidebar,
  toggleRightSidebarExternal,
};

interface UIState {
  /** Left (file-tree) sidebar visibility. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  /** Right (AI Assistant) sidebar visibility. */
  rightSidebarOpen: boolean;
  setRightSidebarOpen: (open: boolean) => void;
  toggleRightSidebar: () => void;
  /**
   * Right-sidebar size as a percentage of the outer Group, matching
   * `react-resizable-panels`. Updated by the Panel's onResize handler
   * and persisted through the session payload via the
   * `getCurrentAssistantState` getter the composition root wires.
   */
  rightSidebarSize: number;
  setRightSidebarSize: (size: number) => void;
}

const UIStateContext = React.createContext<UIState | null>(null);

interface UIStateProviderProps {
  initialSidebarOpen: boolean;
  /**
   * Initial AI Assistant right-sidebar state. The composition root
   * supplies the renderer default (`{ sidebarOpen: false, size: 20 }`)
   * for first launch; on subsequent launches a session-restored value
   * lands via `applyRestoredAssistantState` after `from:session:restore`.
   */
  initialRightSidebarOpen?: boolean;
  initialRightSidebarSize?: number;
  children: React.ReactNode;
}

export const UIStateProvider: React.FC<UIStateProviderProps> = ({
  initialSidebarOpen,
  initialRightSidebarOpen = false,
  initialRightSidebarSize = 20,
  children,
}) => {
  const [sidebarOpen, setSidebarOpen] = React.useState(initialSidebarOpen);
  const [rightSidebarOpen, setRightSidebarOpenState] = React.useState(
    initialRightSidebarOpen,
  );
  const [rightSidebarSize, setRightSidebarSizeState] = React.useState(
    initialRightSidebarSize,
  );

  // Keep the seam's mirror in sync so non-React callers
  // (FileManager.serializeSession) read a fresh value without
  // having to subscribe to React state.
  React.useEffect(() => {
    _syncMirror({ sidebarOpen: rightSidebarOpen, size: rightSidebarSize });
  }, [rightSidebarOpen, rightSidebarSize]);

  // Hand the restore-side setter up to the seam so BridgeListeners
  // can apply a session-restored state on `from:session:restore`.
  // The setter is paired with both pieces of state — restore
  // overwrites both in a single React batch.
  React.useEffect(() => {
    _setRestoreHandler((state) => {
      setRightSidebarOpenState(state.sidebarOpen);
      setRightSidebarSizeState(state.size);
    });
    return () => {
      _setRestoreHandler(null);
    };
  }, []);

  const toggleSidebar = React.useCallback(
    () => setSidebarOpen((open) => !open),
    [],
  );

  const setRightSidebarOpen = React.useCallback((open: boolean) => {
    setRightSidebarOpenState(open);
    _notifyAssistantStateChange();
  }, []);

  const toggleRightSidebar = React.useCallback(() => {
    setRightSidebarOpenState((open) => !open);
    _notifyAssistantStateChange();
  }, []);

  // Register the toggle with the seam used by the
  // application menu (View → Toggle Assistant Sidebar, Cmd/Ctrl+Shift+A)
  // and the system tray entry. Effect-registered so the latest
  // closure wins after a re-render.
  React.useEffect(() => {
    registerToggleRightSidebar(toggleRightSidebar);
    return () => registerToggleRightSidebar(() => {});
  }, [toggleRightSidebar]);

  const setRightSidebarSize = React.useCallback((size: number) => {
    setRightSidebarSizeState(size);
    _notifyAssistantStateChange();
  }, []);

  const value = React.useMemo(
    () => ({
      sidebarOpen,
      setSidebarOpen,
      toggleSidebar,
      rightSidebarOpen,
      setRightSidebarOpen,
      toggleRightSidebar,
      rightSidebarSize,
      setRightSidebarSize,
    }),
    [
      sidebarOpen,
      toggleSidebar,
      rightSidebarOpen,
      setRightSidebarOpen,
      toggleRightSidebar,
      rightSidebarSize,
      setRightSidebarSize,
    ],
  );
  return (
    <UIStateContext.Provider value={value}>{children}</UIStateContext.Provider>
  );
};

export function useUIState(): UIState {
  const ctx = React.useContext(UIStateContext);
  if (!ctx) {
    throw new Error(
      'useUIState() called outside <UIStateProvider>. Wrap the consumer in <App>, which sets up the provider.',
    );
  }
  return ctx;
}
