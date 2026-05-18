import * as React from 'react';

import type { ToolConfirmPreview } from '../../core/AssistantTools';

/**
 * One pending tool-call confirmation. AssistantManager fills this in
 * when a write-class tool fires (and the conversation doesn't have
 * auto-accept on); `<ToolConfirmDialog>` renders it.
 */
export interface ToolConfirmRequest {
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  preview: ToolConfirmPreview | null;
}

interface ToolConfirmState {
  /** Currently-open request, or null when no dialog is shown. */
  request: ToolConfirmRequest | null;
  /**
   * Imperative open — returns a Promise that resolves true on confirm,
   * false on reject / dismiss. Used by React-side callers (`<Probe>`s
   * in tests etc.); production code goes through `confirmToolCallExternal`.
   */
  open: (req: ToolConfirmRequest) => Promise<boolean>;
  /** Resolve the current request — wired to the dialog buttons. */
  resolve: (ok: boolean) => void;
}

const ToolConfirmContext = React.createContext<ToolConfirmState | null>(null);

export const ToolConfirmProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [request, setRequest] = React.useState<ToolConfirmRequest | null>(null);
  // Keep the in-flight resolver on a ref so the dialog buttons resolve
  // the exact Promise the manager is awaiting (and so a second open
  // call while a dialog is still up cancels the prior one cleanly).
  const resolverRef = React.useRef<((ok: boolean) => void) | null>(null);

  const open = React.useCallback((req: ToolConfirmRequest): Promise<boolean> => {
    // If a prior request is still showing, reject it as "dismiss"
    // before swapping — the user's intent on the new request is what
    // we care about.
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
    setRequest(req);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const resolve = React.useCallback((ok: boolean) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    if (r) r(ok);
  }, []);

  const value = React.useMemo<ToolConfirmState>(
    () => ({ request, open, resolve }),
    [request, open, resolve],
  );

  return (
    <ToolConfirmContext.Provider value={value}>
      {children}
    </ToolConfirmContext.Provider>
  );
};

export function useToolConfirm(): ToolConfirmState {
  const ctx = React.useContext(ToolConfirmContext);
  if (!ctx) {
    throw new Error(
      'useToolConfirm() called outside <ToolConfirmProvider>. Wrap in <App>.',
    );
  }
  return ctx;
}

/* -------------------------------------------------------------------- */
/*  Module-level seam for non-React callers (AssistantManager)            */
/* -------------------------------------------------------------------- */

let externalOpen: ((req: ToolConfirmRequest) => Promise<boolean>) | null = null;

export function registerToolConfirmOpener(
  fn: (req: ToolConfirmRequest) => Promise<boolean>,
) {
  externalOpen = fn;
}

/**
 * Open the tool-call confirm dialog from non-React code. Resolves
 * with `true` on accept, `false` on reject / dismiss / no-provider.
 *
 * If the React tree hasn't mounted the provider yet (early boot),
 * the call resolves false — i.e. write-class tools fail closed
 * rather than silently executing without the user's OK.
 */
export function confirmToolCallExternal(
  req: ToolConfirmRequest,
): Promise<boolean> {
  if (!externalOpen) return Promise.resolve(false);
  return externalOpen(req);
}
