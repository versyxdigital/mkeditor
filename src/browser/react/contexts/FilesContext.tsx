import * as React from 'react';

import type { FilesSnapshot } from '../../core/FileManager';
import { useManagers } from './ManagersContext';

const EMPTY_SNAPSHOT: FilesSnapshot = { tabs: [], activeFile: null };

const FilesContext = React.createContext<FilesSnapshot>(EMPTY_SNAPSHOT);

/**
 * Reactive view of FileManager's tabs + activeFile. Uses
 * `useSyncExternalStore` against the manager's `on('change')` emitter and
 * `getSnapshot()`, so React re-renders only when the file model changes.
 *
 * `fileManager` is null on the initial mount (constructed inside
 * `onEditorReady` in the composition root); the empty snapshot covers
 * that gap. Once the composition root calls `setManagers`, this provider
 * re-runs subscribe with the live FileManager.
 */
export const FilesProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { fileManager } = useManagers();

  const subscribe = React.useCallback(
    (listener: () => void) => {
      if (!fileManager) return () => {};
      return fileManager.on('change', listener);
    },
    [fileManager],
  );

  const getSnapshot = React.useCallback(
    () => fileManager?.getSnapshot() ?? EMPTY_SNAPSHOT,
    [fileManager],
  );

  const snapshot = React.useSyncExternalStore(subscribe, getSnapshot);

  return (
    <FilesContext.Provider value={snapshot}>{children}</FilesContext.Provider>
  );
};

export function useFiles(): FilesSnapshot {
  return React.useContext(FilesContext);
}
