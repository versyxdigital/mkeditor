import * as React from 'react';

import type {
  EditorSettings,
  EditorSettingsSnapshot,
} from '../../interfaces/Editor';
import type { SettingsProvider } from '../../core/providers/SettingsProvider';
import { settings as defaults } from '../../config';
import { useManagers } from './ManagersContext';

const fallbackSnapshot: EditorSettingsSnapshot = {
  ...defaults,
  effectiveDarkmode: defaults.darkmode,
};

interface SettingsContextValue {
  settings: EditorSettingsSnapshot;
  /**
   * Single React-facing setter. Behind the scenes this is
   * `provider.updateSetting(key, value)` which writes state, applies
   * the Monaco/theme side effect, emits to subscribers, and persists
   * via localStorage / IPC bridge.
   */
  updateSetting: <K extends keyof EditorSettings>(
    key: K,
    value: EditorSettings[K],
  ) => void;
}

const SettingsContext = React.createContext<SettingsContextValue>({
  settings: fallbackSnapshot,
  updateSetting: () => {},
});

/**
 * Reactive view of SettingsProvider. Uses `useSyncExternalStore` against
 * the provider's `subscribe`/`getSnapshot` pair. Tolerates a null
 * SettingsProvider (initial mount, before onEditorReady wires it) by
 * falling back to the defaults snapshot.
 */
export const SettingsContextProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const { providers } = useManagers();
  const provider = providers.settings as SettingsProvider | null;

  const subscribe = React.useCallback(
    (listener: () => void) => {
      if (!provider) return () => {};
      return provider.subscribe(listener);
    },
    [provider],
  );

  const getSnapshot = React.useCallback(
    () => provider?.getSnapshot() ?? fallbackSnapshot,
    [provider],
  );

  const settings = React.useSyncExternalStore(subscribe, getSnapshot);

  const updateSetting = React.useCallback(
    <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => {
      provider?.updateSetting(key, value);
    },
    [provider],
  );

  const value = React.useMemo<SettingsContextValue>(
    () => ({ settings, updateSetting }),
    [settings, updateSetting],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export function useSettings(): SettingsContextValue {
  return React.useContext(SettingsContext);
}
