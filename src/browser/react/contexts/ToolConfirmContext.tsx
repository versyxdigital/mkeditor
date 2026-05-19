import * as React from 'react';

import {
  confirmToolCallExternal,
  registerToolConfirmOpener,
  type ToolConfirmRequest,
} from '../../toolConfirm';

// Re-export so existing React-side callers keep their import path.
// The seam itself lives at `src/browser/toolConfirm.ts` (outside
// `react/`) so managers can call `confirmToolCallExternal` without
// importing React — see the comment at the top of `toolConfirm.ts`.
export type { ToolConfirmRequest };
export { confirmToolCallExternal, registerToolConfirmOpener };

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

// The module-level seam (`confirmToolCallExternal`,
// `registerToolConfirmOpener`, `ToolConfirmRequest`) lives in
// `src/browser/toolConfirm.ts` so manager-side callers can use it
// without importing React. We re-export above for the existing
// React-side imports.
