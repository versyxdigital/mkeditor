import * as React from 'react';

import type { FileTreeSnapshot } from '../../core/FileTreeManager';
import { useManagers } from './ManagersContext';

const EMPTY_SNAPSHOT: FileTreeSnapshot = { treeRoot: null, nodes: [] };

const FileTreeContext = React.createContext<FileTreeSnapshot>(EMPTY_SNAPSHOT);

/**
 * Reactive view of FileTreeManager's tree. Mirrors FilesContext: pulls
 * the stable snapshot via `useSyncExternalStore` and tolerates a null
 * fileTreeManager during the initial mount window before `onEditorReady`
 * constructs BridgeManager.
 */
export const FileTreeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { fileTreeManager } = useManagers();

  const subscribe = React.useCallback(
    (listener: () => void) => {
      if (!fileTreeManager) return () => {};
      return fileTreeManager.on('change', listener);
    },
    [fileTreeManager],
  );

  const getSnapshot = React.useCallback(
    () => fileTreeManager?.getSnapshot() ?? EMPTY_SNAPSHOT,
    [fileTreeManager],
  );

  const snapshot = React.useSyncExternalStore(subscribe, getSnapshot);

  return (
    <FileTreeContext.Provider value={snapshot}>
      {children}
    </FileTreeContext.Provider>
  );
};

export function useFileTree(): FileTreeSnapshot {
  return React.useContext(FileTreeContext);
}
