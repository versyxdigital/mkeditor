import * as React from 'react';

import { useManagers } from './ManagersContext';

export interface WindowControls {
  isMaximized: boolean;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  toggleFullscreen: () => void;
}

const NOOP: WindowControls = {
  isMaximized: false,
  minimize: () => {},
  maximize: () => {},
  close: () => {},
  toggleFullscreen: () => {},
};

const EMPTY_STATE = { isMaximized: false };

const WindowContext = React.createContext<WindowControls>(NOOP);

/**
 * Reactive view of BridgeManager's window-control surface. Reads
 * `isMaximized` via `useSyncExternalStore` against
 * `subscribeWindowState`/`getWindowState`; the imperative methods proxy
 * directly to BridgeManager which forwards over the bridge.
 *
 * Web mode and the initial pre-mount window have no BridgeManager — the
 * context falls back to a NOOP shape so consumers can render without a
 * null check.
 */
export const WindowProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { bridgeManager, mode } = useManagers();

  const subscribe = React.useCallback(
    (listener: () => void) => {
      if (!bridgeManager) return () => {};
      return bridgeManager.subscribeWindowState(listener);
    },
    [bridgeManager],
  );

  const getSnapshot = React.useCallback(
    () => bridgeManager?.getWindowState() ?? EMPTY_STATE,
    [bridgeManager],
  );

  const state = React.useSyncExternalStore(subscribe, getSnapshot);

  const value = React.useMemo<WindowControls>(() => {
    // No bridge yet (initial mount) or web mode without window-control
    // IPC — render the buttons but make them inert. Web's `<TitleBar>`
    // hides the controls entirely so this is mostly defensive.
    if (!bridgeManager || mode === 'web') {
      return { ...NOOP, isMaximized: state.isMaximized };
    }
    return {
      isMaximized: state.isMaximized,
      minimize: () => bridgeManager.windowMinimize(),
      maximize: () => bridgeManager.windowMaximize(),
      close: () => bridgeManager.windowClose(),
      toggleFullscreen: () => bridgeManager.windowToggleFullscreen(),
    };
  }, [bridgeManager, mode, state.isMaximized]);

  return (
    <WindowContext.Provider value={value}>{children}</WindowContext.Provider>
  );
};

export function useWindowControls(): WindowControls {
  return React.useContext(WindowContext);
}
