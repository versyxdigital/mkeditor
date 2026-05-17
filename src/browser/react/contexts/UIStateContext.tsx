import * as React from 'react';

interface UIState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

const UIStateContext = React.createContext<UIState | null>(null);

interface UIStateProviderProps {
  initialSidebarOpen: boolean;
  children: React.ReactNode;
}

export const UIStateProvider: React.FC<UIStateProviderProps> = ({
  initialSidebarOpen,
  children,
}) => {
  const [sidebarOpen, setSidebarOpen] = React.useState(initialSidebarOpen);
  const toggleSidebar = React.useCallback(
    () => setSidebarOpen((open) => !open),
    [],
  );
  const value = React.useMemo(
    () => ({ sidebarOpen, setSidebarOpen, toggleSidebar }),
    [sidebarOpen, toggleSidebar],
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
