import * as React from 'react';

import type { ExportSettings } from '../../interfaces/Editor';
import type { ExportSettingsProvider } from '../../core/providers/ExportSettingsProvider';
import { exportSettings as defaults } from '../../config';
import { useManagers } from './ManagersContext';

interface ExportSettingsContextValue {
  settings: ExportSettings;
  updateSetting: <K extends keyof ExportSettings>(
    key: K,
    value: ExportSettings[K],
  ) => void;
}

const ExportSettingsContext = React.createContext<ExportSettingsContextValue>({
  settings: defaults,
  updateSetting: () => {},
});

/**
 * Reactive view of ExportSettingsProvider. Mirrors SettingsContext.
 */
export const ExportSettingsContextProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const { providers } = useManagers();
  const provider = providers.exportSettings as ExportSettingsProvider | null;

  const subscribe = React.useCallback(
    (listener: () => void) => {
      if (!provider) return () => {};
      return provider.subscribe(listener);
    },
    [provider],
  );

  const getSnapshot = React.useCallback(
    () => provider?.getSnapshot() ?? defaults,
    [provider],
  );

  const settings = React.useSyncExternalStore(subscribe, getSnapshot);

  const updateSetting = React.useCallback(
    <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) => {
      provider?.updateSetting(key, value);
    },
    [provider],
  );

  const value = React.useMemo<ExportSettingsContextValue>(
    () => ({ settings, updateSetting }),
    [settings, updateSetting],
  );

  return (
    <ExportSettingsContext.Provider value={value}>
      {children}
    </ExportSettingsContext.Provider>
  );
};

export function useExportSettings(): ExportSettingsContextValue {
  return React.useContext(ExportSettingsContext);
}
