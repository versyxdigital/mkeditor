import * as React from 'react';

import type { FileProperties } from '../../interfaces/File';

interface PropertiesContextValue {
  info: FileProperties | null;
  show: (info: FileProperties) => void;
  close: () => void;
}

const PropertiesContext = React.createContext<PropertiesContextValue | null>(
  null,
);

/**
 * Holds the currently-displayed FileProperties payload. The actual UI
 * lives in `<PropertiesModal>` (rendered by `<App>`); this context is
 * what binds the BridgeListeners `from:path:properties` handler to the
 * React tree via `showPropertiesExternal` below.
 */
export const PropertiesProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [info, setInfo] = React.useState<FileProperties | null>(null);

  const show = React.useCallback((next: FileProperties) => setInfo(next), []);
  const close = React.useCallback(() => setInfo(null), []);

  const value = React.useMemo(
    () => ({ info, show, close }),
    [info, show, close],
  );

  return (
    <PropertiesContext.Provider value={value}>
      {children}
    </PropertiesContext.Provider>
  );
};

export function useProperties(): PropertiesContextValue {
  const ctx = React.useContext(PropertiesContext);
  if (!ctx) {
    throw new Error('useProperties() called outside <PropertiesProvider>');
  }
  return ctx;
}

/* -------------------------------------------------------------------- */
/*  Module-level entrypoint for non-React callers                       */
/* -------------------------------------------------------------------- */

let externalShow: ((info: FileProperties) => void) | null = null;

export function registerPropertiesShower(fn: (info: FileProperties) => void) {
  externalShow = fn;
}

/**
 * Open the properties modal from non-React code (specifically the
 * `from:path:properties` IPC handler in BridgeListeners).
 */
export function showPropertiesExternal(info: FileProperties) {
  externalShow?.(info);
}
