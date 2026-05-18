import * as React from 'react';

import type { AssistantManager } from '../../core/AssistantManager';
import type { AssistantConfigSnapshot } from '../../core/AssistantManager';
import type { AssistantChatSnapshot } from '../../../app/interfaces/Assistant';
import { useManagers } from './ManagersContext';

const DEFAULT_SNAPSHOT: AssistantConfigSnapshot = {
  config: null,
  encryptionAvailable: false,
};

const EMPTY_CHAT_SNAPSHOT: AssistantChatSnapshot = {
  conversations: { anthropic: [], openai: [], ollama: [] },
  activeConversation: { anthropic: null, openai: null, ollama: null },
  activeProvider: null,
  drafts: {},
  inflight: {},
};

interface AssistantContextValue {
  /** Sanitized config + encryption flag, or the default `null`-config snapshot while loading. */
  snapshot: AssistantConfigSnapshot;
  /**
   * Live manager reference. Settings UI calls `setProviderConfig`,
   * `setKey`, `clearKey`, `refreshOllamaModels`, `testConnection` etc.
   * directly on this. Null until the composition root wires it.
   */
  manager: AssistantManager | null;
}

const AssistantContext = React.createContext<AssistantContextValue>({
  snapshot: DEFAULT_SNAPSHOT,
  manager: null,
});

/**
 * Reactive view of `AssistantManager`. Subscribes via the standard
 * `useSyncExternalStore` pattern to the manager's
 * `subscribeConfig` / `getConfigSnapshot` pair. Tolerates a null
 * manager (initial mount, before `onEditorReady` wires it) by
 * falling back to the default `null`-config snapshot.
 *
 * Mounted inside `<App>` once the manager lives on `Managers`.
 */
export const AssistantContextProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const { assistantManager } = useManagers();

  const subscribe = React.useCallback(
    (listener: () => void) => {
      if (!assistantManager) return () => {};
      return assistantManager.subscribeConfig(listener);
    },
    [assistantManager],
  );

  const getSnapshot = React.useCallback(
    () => assistantManager?.getConfigSnapshot() ?? DEFAULT_SNAPSHOT,
    [assistantManager],
  );

  const snapshot = React.useSyncExternalStore(subscribe, getSnapshot);

  const value = React.useMemo<AssistantContextValue>(
    () => ({ snapshot, manager: assistantManager }),
    [snapshot, assistantManager],
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
};

export function useAssistantConfig(): AssistantContextValue {
  return React.useContext(AssistantContext);
}

/**
 * Reactive view of `AssistantManager`'s chat snapshot. Separate from
 * `useAssistantConfig` so settings-only consumers don't re-render on
 * chat churn (chunks fire multiple times per second during streaming).
 *
 * The hook subscribes / unsubscribes against the live manager
 * reference each render — when the manager finally arrives via
 * `setReactManagers`, `useSyncExternalStore`'s subscribe re-runs and
 * the consumer wires up automatically.
 */
export function useAssistantChat(): {
  chat: AssistantChatSnapshot;
  manager: AssistantManager | null;
} {
  const { assistantManager } = useManagers();

  const subscribe = React.useCallback(
    (listener: () => void) => {
      if (!assistantManager) return () => {};
      return assistantManager.subscribeChat(listener);
    },
    [assistantManager],
  );

  const getSnapshot = React.useCallback(
    () => assistantManager?.getChatSnapshot() ?? EMPTY_CHAT_SNAPSHOT,
    [assistantManager],
  );

  const chat = React.useSyncExternalStore(subscribe, getSnapshot);
  return { chat, manager: assistantManager };
}
