import * as React from 'react';
import type { AssistantViewState } from '../../interfaces/Session';

interface UIState {
  /** Left (file-tree) sidebar visibility. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  /** Right (AI Assistant) sidebar visibility (AI Assistant P2). */
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

// ---------------------------------------------------------------------
// Cross-boundary seams (read by FileManager + BridgeListeners — both
// non-React callers). Same module-level pattern as `openModalExternal`,
// `dispatchMenuActionExternal`, etc.
// ---------------------------------------------------------------------

/**
 * Live mirror of the React state, kept in sync via a useEffect inside
 * `UIStateProvider`. The composition root passes
 * `getCurrentAssistantState` to `FileManager.setAssistantStateGetter`
 * so `serializeSession()` can read the current value synchronously
 * from non-React code without holding a context handle.
 */
const currentAssistantState: AssistantViewState = {
  sidebarOpen: false,
  size: 20,
};

export function getCurrentAssistantState(): AssistantViewState {
  return { sidebarOpen: currentAssistantState.sidebarOpen, size: currentAssistantState.size };
}

/**
 * Setter handed up by `UIStateProvider` so `BridgeListeners` can push
 * the session-restored assistant block back into React state on
 * `from:session:restore`. Null until the provider mounts.
 */
let restoreAssistantStateSetter:
  | ((state: AssistantViewState) => void)
  | null = null;

export function applyRestoredAssistantState(state: AssistantViewState): void {
  restoreAssistantStateSetter?.(state);
}

/**
 * Callback the composition root sets so changes to the right-sidebar
 * state schedule a session save (debounced through FileManager's
 * existing pipeline). Decouples UIStateContext from FileManager —
 * UIStateContext fires the notification; whoever wired it up owns the
 * downstream effect.
 */
let assistantStateChangeListener: (() => void) | null = null;

export function registerAssistantStateChangeListener(fn: () => void): void {
  assistantStateChangeListener = fn;
}

export function clearAssistantStateChangeListener(): void {
  assistantStateChangeListener = null;
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

  // Keep the module-level mirror in sync so non-React callers (the
  // FileManager.serializeSession getter) read a fresh value without
  // having to subscribe to React state.
  React.useEffect(() => {
    currentAssistantState.sidebarOpen = rightSidebarOpen;
    currentAssistantState.size = rightSidebarSize;
  }, [rightSidebarOpen, rightSidebarSize]);

  // Hand the restore-side setter up to the module-level seam so
  // BridgeListeners can apply a session-restored state on
  // `from:session:restore`. The setter is paired with both pieces of
  // state — restore overwrites both in a single React batch.
  React.useEffect(() => {
    restoreAssistantStateSetter = (state) => {
      setRightSidebarOpenState(state.sidebarOpen);
      setRightSidebarSizeState(state.size);
    };
    return () => {
      restoreAssistantStateSetter = null;
    };
  }, []);

  const toggleSidebar = React.useCallback(
    () => setSidebarOpen((open) => !open),
    [],
  );

  const setRightSidebarOpen = React.useCallback((open: boolean) => {
    setRightSidebarOpenState(open);
    assistantStateChangeListener?.();
  }, []);

  const toggleRightSidebar = React.useCallback(() => {
    setRightSidebarOpenState((open) => !open);
    assistantStateChangeListener?.();
  }, []);

  const setRightSidebarSize = React.useCallback((size: number) => {
    setRightSidebarSizeState(size);
    assistantStateChangeListener?.();
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
