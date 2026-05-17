import * as React from 'react';

import type { EditorManager } from '../../core/EditorManager';
import type { BridgeManager } from '../../core/BridgeManager';
import type { FileManager } from '../../core/FileManager';
import type { FileTreeManager } from '../../core/FileTreeManager';
import type { EditorDispatcher } from '../../events/EditorDispatcher';
import type { EditorProviders } from '../../interfaces/Providers';

export interface Managers {
  mode: 'web' | 'desktop';
  /**
   * Null until the lazy-loaded `core/EditorManager` chunk lands. The
   * composition root pushes the constructed instance in via
   * `setReactManagers` once `boot()` completes; <EditorHost>'s
   * useEffect is gated on this being non-null before calling
   * `editorManager.create()`.
   */
  editorManager: EditorManager | null;
  dispatcher: EditorDispatcher;
  /** Constructed in onEditorReady; null until then. */
  fileManager: FileManager | null;
  /** Constructed in onEditorReady; null until then. */
  fileTreeManager: FileTreeManager | null;
  /** Desktop-only; null in web mode. Wired in onEditorReady. */
  bridgeManager: BridgeManager | null;
  /**
   * Live reference to `editorManager.providers`. The map is mutated by
   * `onEditorReady` after Monaco creation, so consumers should read fields
   * lazily rather than destructuring at provider time.
   */
  providers: EditorProviders;
}

const ManagersContext = React.createContext<Managers | null>(null);

export const ManagersProvider = ManagersContext.Provider;

export function useManagers(): Managers {
  const ctx = React.useContext(ManagersContext);
  if (!ctx) {
    throw new Error(
      'useManagers() called outside <ManagersProvider>. The composition root must mount <App> before any consumer renders.',
    );
  }
  return ctx;
}
