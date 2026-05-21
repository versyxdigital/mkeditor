import * as React from 'react';

import {
  cancelToolConfirmForToolCallId,
  cancelToolConfirmsForCallId,
  confirmToolCallExternal,
  registerToolConfirmCanceller,
  registerToolConfirmOpener,
  registerToolConfirmToolCallCanceller,
  type ToolConfirmRequest,
} from '../../toolConfirm';

// Re-export so existing React-side callers keep their import path.
// The seam itself lives at `src/browser/toolConfirm.ts` (outside
// `react/`) so managers can call `confirmToolCallExternal` without
// importing React — see the comment at the top of `toolConfirm.ts`.
export type { ToolConfirmRequest };
export {
  cancelToolConfirmForToolCallId,
  cancelToolConfirmsForCallId,
  confirmToolCallExternal,
  registerToolConfirmCanceller,
  registerToolConfirmOpener,
  registerToolConfirmToolCallCanceller,
};

interface ToolConfirmState {
  /** Currently-open request, or null when no dialog is shown. */
  request: ToolConfirmRequest | null;
  /**
   * Imperative open — returns a Promise that resolves true on confirm,
   * false on reject / dismiss. Used by React-side callers (`<Probe>`s
   * in tests etc.); production code goes through `confirmToolCallExternal`.
   *
   * Multiple opens are queued (FIFO) — a second call while a dialog is
   * up does NOT cancel the first.
   */
  open: (req: ToolConfirmRequest) => Promise<boolean>;
  /** Resolve the current request — wired to the dialog buttons. */
  resolve: (ok: boolean) => void;
  /**
   * Drop every queued or in-flight confirmation belonging to a chat
   * `callId` that has just been cancelled. Each affected Promise
   * resolves false.
   */
  cancelForCallId: (callId: string) => void;
  /**
   * Drop a single modal confirmation by `toolCallId`. Used by
   * `AssistantManager` after the inline confirmation card resolves a
   * write-class tool so the redundant modal doesn't linger.
   */
  cancelForToolCallId: (toolCallId: string) => void;
}

/** Queue entry: one pending request plus the resolver for its Promise. */
interface QueuedConfirm {
  request: ToolConfirmRequest;
  resolve: (ok: boolean) => void;
}

const ToolConfirmContext = React.createContext<ToolConfirmState | null>(null);

export const ToolConfirmProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [request, setRequest] = React.useState<ToolConfirmRequest | null>(null);
  // Resolver for the CURRENTLY-SHOWN dialog. Held on a ref so the
  // dialog buttons resolve the exact Promise the caller is awaiting.
  const currentResolverRef = React.useRef<((ok: boolean) => void) | null>(null);
  // FIFO queue of confirmations waiting their turn behind whatever is
  // currently on screen. A ref because callbacks below mutate it
  // synchronously across renders; surfacing it as state would buy us
  // nothing (the queue isn't rendered).
  const queueRef = React.useRef<QueuedConfirm[]>([]);
  // Mirror of `request` so `cancelForCallId` (held with a stable
  // identity across renders) can read the latest value without
  // capturing a stale closure. Updated in the effect below on every
  // render.
  const requestRef = React.useRef<ToolConfirmRequest | null>(null);

  /** Promote the next queued entry into the on-screen slot (if any). */
  const showNextFromQueue = React.useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      currentResolverRef.current = null;
      setRequest(null);
      return;
    }
    currentResolverRef.current = next.resolve;
    setRequest(next.request);
  }, []);

  const open = React.useCallback(
    (req: ToolConfirmRequest): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        if (currentResolverRef.current) {
          // A dialog is already on screen — queue this request behind
          // it. The prior dialog is NOT force-resolved (that's the
          // bug this fix was for: a parallel tool-call would surface
          // as "User declined" without the user clicking anything).
          queueRef.current.push({ request: req, resolve });
          return;
        }
        currentResolverRef.current = resolve;
        setRequest(req);
      });
    },
    [],
  );

  const resolve = React.useCallback(
    (ok: boolean) => {
      const r = currentResolverRef.current;
      if (r) r(ok);
      showNextFromQueue();
    },
    [showNextFromQueue],
  );

  const cancelForCallId = React.useCallback(
    (callId: string) => {
      // Drain the queue: every entry tagged with this callId resolves
      // false. Untagged entries (callId omitted by the caller) and
      // entries from other chats are left in place.
      const survivors: QueuedConfirm[] = [];
      for (const entry of queueRef.current) {
        if (entry.request.callId === callId) {
          entry.resolve(false);
        } else {
          survivors.push(entry);
        }
      }
      queueRef.current = survivors;
      // If the currently-shown dialog belongs to the cancelled chat,
      // resolve it false and promote the next queue entry. The manager
      // bails on `inflightChats.get(callId) === undefined` before
      // emitting any tool-result, so the user doesn't see a phantom
      // "rejected" message for the chat they just cancelled.
      const currentRequest = requestRef.current;
      if (currentRequest && currentRequest.callId === callId) {
        const r = currentResolverRef.current;
        if (r) r(false);
        showNextFromQueue();
      }
    },
    [showNextFromQueue],
  );

  const cancelForToolCallId = React.useCallback(
    (toolCallId: string) => {
      // Single-entry variant used by AssistantManager after the inline
      // confirmation card resolves a write-class tool. The matching
      // modal entry (in the queue OR currently shown) is dropped so
      // the user doesn't see a redundant dialog they've already
      // responded to. Resolved as false because the Promise the
      // manager is awaiting has already been resolved by the inline
      // path; the second resolve is a no-op.
      const survivors: QueuedConfirm[] = [];
      for (const entry of queueRef.current) {
        if (entry.request.toolCallId === toolCallId) {
          entry.resolve(false);
        } else {
          survivors.push(entry);
        }
      }
      queueRef.current = survivors;
      const currentRequest = requestRef.current;
      if (currentRequest && currentRequest.toolCallId === toolCallId) {
        const r = currentResolverRef.current;
        if (r) r(false);
        showNextFromQueue();
      }
    },
    [showNextFromQueue],
  );

  // Keep `requestRef` in sync with the rendered request so
  // `cancelForCallId` reads the latest value. The module-level seam
  // registrations (opener + canceller) happen in `<ToolConfirmBridge>`
  // inside App.tsx, not here — keeps the manager → React wiring
  // concentrated in one place.
  React.useEffect(() => {
    requestRef.current = request;
  }, [request]);

  const value = React.useMemo<ToolConfirmState>(
    () => ({
      request,
      open,
      resolve,
      cancelForCallId,
      cancelForToolCallId,
    }),
    [request, open, resolve, cancelForCallId, cancelForToolCallId],
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

// The module-level seams (`confirmToolCallExternal`,
// `cancelToolConfirmsForCallId`, plus their `register*` counterparts
// and the `ToolConfirmRequest` type) live in
// `src/browser/toolConfirm.ts` so manager-side callers can use them
// without importing React. We re-export above for the existing
// React-side imports.
