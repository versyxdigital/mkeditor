import type { ToolConfirmPreview } from '../app/interfaces/Assistant';

/**
 * Module-level seam for the tool-call confirm dialog.
 *
 * The React `<ToolConfirmProvider>` registers its `open` callback
 * here at mount via `registerToolConfirmOpener`. Manager-side code
 * (today: `AssistantManager.runWithConfirmation` when a write-class
 * tool fires without auto-accept) calls `confirmToolCallExternal`
 * to surface the dialog and await the user's decision — without
 * ever importing React.
 *
 * Lives at `src/browser/` (NOT under `react/`) so the manager →
 * React import is one-way: managers see this neutral seam file;
 * React imports the seam to plug in its dialog. Same pattern as
 * `src/browser/notify.ts` (sonner toast) and the other module-level
 * seams that bridge the boundary.
 */

/**
 * One pending tool-call confirmation. AssistantManager fills this in
 * when a write-class tool fires (and the conversation doesn't have
 * auto-accept on); `<ToolConfirmDialog>` renders it.
 *
 * `callId` is the in-flight chat id the tool-call belongs to. The
 * `<ToolConfirmProvider>` queue uses it to drop confirmations
 * belonging to a chat the user has just cancelled, so the user
 * doesn't get prompted for tool-calls from a conversation they've
 * already walked away from.
 */
export interface ToolConfirmRequest {
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  preview: ToolConfirmPreview | null;
  callId?: string;
}

let externalOpen: ((req: ToolConfirmRequest) => Promise<boolean>) | null = null;
let externalCancelForCallId: ((callId: string) => void) | null = null;
let externalCancelForToolCallId: ((toolCallId: string) => void) | null = null;

export function registerToolConfirmOpener(
  fn: (req: ToolConfirmRequest) => Promise<boolean>,
): void {
  externalOpen = fn;
}

/**
 * Register the React-side hook that drops every queued or in-flight
 * confirmation belonging to `callId` (the chat the user just
 * cancelled). Each affected Promise resolves to `false` — and since
 * `AssistantManager.runWithConfirmation` already bails when the
 * matching inflight chat is gone, no spurious "User declined"
 * tool-result is shipped.
 */
export function registerToolConfirmCanceller(
  fn: (callId: string) => void,
): void {
  externalCancelForCallId = fn;
}

/**
 * Register the React-side hook that drops a single queued or
 * in-flight modal confirmation by `toolCallId`. Used by the inline
 * confirmation path (`<ToolCallCard>`) to dismiss the redundant modal
 * dialog the moment the user accepts/rejects inline — otherwise the
 * modal would sit there showing stale content for an action the user
 * already responded to.
 */
export function registerToolConfirmToolCallCanceller(
  fn: (toolCallId: string) => void,
): void {
  externalCancelForToolCallId = fn;
}

/**
 * Open the tool-call confirm dialog from non-React code. Resolves
 * with `true` on accept, `false` on reject / dismiss / no-provider.
 *
 * Multiple in-flight calls (parallel tool-calls in a single
 * assistant turn) are queued — they show one at a time in arrival
 * order. A prior call is NEVER force-resolved to make room for a
 * later one; that would surface as "User declined the tool call"
 * for an action the user never had the chance to evaluate.
 *
 * If the React tree hasn't mounted the provider yet (early boot),
 * the call resolves false — write-class tools fail closed rather
 * than silently executing without the user's OK.
 */
export function confirmToolCallExternal(
  req: ToolConfirmRequest,
): Promise<boolean> {
  if (!externalOpen) return Promise.resolve(false);
  return externalOpen(req);
}

/**
 * Drop every queued or in-flight confirmation for `callId`. Called
 * by `AssistantManager.cancelCall` so the user isn't prompted for
 * tool-calls from a chat they've already cancelled. No-op when no
 * provider is registered (early boot / web mode).
 */
export function cancelToolConfirmsForCallId(callId: string): void {
  externalCancelForCallId?.(callId);
}

/**
 * Drop a single modal confirmation by `toolCallId`. Fired by
 * `AssistantManager` after the inline path resolves an entry, so the
 * redundant modal doesn't linger on screen. No-op when no provider
 * is registered.
 */
export function cancelToolConfirmForToolCallId(toolCallId: string): void {
  externalCancelForToolCallId?.(toolCallId);
}
