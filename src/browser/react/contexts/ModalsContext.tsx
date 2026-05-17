import * as React from 'react';

export type ModalKey = 'settings' | 'exportSettings' | 'about' | 'shortcuts';

export interface ModalsState {
  open: ModalKey | null;
  openModal: (key: ModalKey) => void;
  closeModal: () => void;
}

const ModalsContext = React.createContext<ModalsState | null>(null);

/**
 * Centralised React state for which modal (Settings / Export settings /
 * About / Shortcuts) is currently open.
 *
 * BridgeListeners' `from:modal:open` handler dispatches into this
 * context via the registered setter (see `registerOpenModal`).
 */
export const ModalsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [open, setOpen] = React.useState<ModalKey | null>(null);
  const openModal = React.useCallback((key: ModalKey) => setOpen(key), []);
  const closeModal = React.useCallback(() => setOpen(null), []);

  const value = React.useMemo(
    () => ({ open, openModal, closeModal }),
    [open, openModal, closeModal],
  );

  return (
    <ModalsContext.Provider value={value}>{children}</ModalsContext.Provider>
  );
};

export function useModals(): ModalsState {
  const ctx = React.useContext(ModalsContext);
  if (!ctx) {
    throw new Error('useModals() called outside <ModalsProvider>');
  }
  return ctx;
}

/**
 * Module-level setter handed back by the composition root so non-React
 * code paths (e.g., BridgeListeners' `from:modal:open`, the
 * `command:palette` and Monaco keybindings inside CommandProvider) can
 * trigger a modal without holding a React ref.
 *
 * Updated by <App> on the first render via `registerOpenModal`.
 */
let externalOpenModal: ((key: ModalKey) => void) | null = null;

export function registerOpenModal(fn: (key: ModalKey) => void) {
  externalOpenModal = fn;
}

export function openModalExternal(key: ModalKey) {
  externalOpenModal?.(key);
}
