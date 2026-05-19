import * as React from 'react';

export type ModalKey = 'settings' | 'exportSettings' | 'about' | 'shortcuts';

/**
 * Optional payload openers can hand to `openModal`. Only the settings
 * modal consumes one today (the AI Assistant sidebar empty-state
 * CTA opens the modal directly on the AI Providers tab); the others
 * are flag-only. Keep this union narrow so type-checking catches a
 * typo at the call site.
 */
export type ModalPayload =
  | { tab?: 'general' | 'assistant' }
  | null
  | undefined;

export interface ModalsState {
  open: ModalKey | null;
  /**
   * Most recent payload from `openModal`. Cleared on `closeModal`.
   * SettingsModal reads `payload?.tab` to pick the initial tab.
   */
  payload: ModalPayload;
  openModal: (key: ModalKey, payload?: ModalPayload) => void;
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
  const [payload, setPayload] = React.useState<ModalPayload>(null);

  const openModal = React.useCallback(
    (key: ModalKey, next?: ModalPayload) => {
      setOpen(key);
      setPayload(next ?? null);
    },
    [],
  );
  const closeModal = React.useCallback(() => {
    setOpen(null);
    setPayload(null);
  }, []);

  const value = React.useMemo(
    () => ({ open, payload, openModal, closeModal }),
    [open, payload, openModal, closeModal],
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
 * Updated by <App> on the first render via `registerOpenModal`. The
 * external surface accepts an optional `payload` so callers like
 * the Help → "Configure AI Providers..." menu item can open the
 * Settings modal directly on the AI Providers tab via
 * `openModalExternal('settings', { tab: 'assistant' })`. Non-React
 * callers that don't need it pass nothing — the React `openModal`
 * function ignores undefined payloads cleanly.
 */
let externalOpenModal:
  | ((key: ModalKey, payload?: ModalPayload) => void)
  | null = null;

export function registerOpenModal(
  fn: (key: ModalKey, payload?: ModalPayload) => void,
) {
  externalOpenModal = fn;
}

export function openModalExternal(key: ModalKey, payload?: ModalPayload) {
  externalOpenModal?.(key, payload);
}
