import type { AssistantViewState } from './interfaces/Session';

/**
 * Module-level seam for the AI Assistant right-sidebar's view state.
 *
 * Owns the three plumbing roles that need to cross the manager /
 * React boundary without coupling either side to the other:
 *
 *   - **Mirror read** (`getCurrentAssistantState`) — non-React
 *     callers (`FileManager.serializeSession`) need a synchronous
 *     read of the latest sidebar open/size for session persistence.
 *     The React provider mutates the mirror in a useEffect so the
 *     read is always fresh.
 *
 *   - **Restore push** (`applyRestoredAssistantState`) — on
 *     `from:session:restore`, BridgeListeners hands the saved view
 *     state to React via the registered setter.
 *
 *   - **Change notification** (`registerAssistantStateChangeListener`
 *     / `clearAssistantStateChangeListener`) — the composition root
 *     wires a "schedule session save" callback that fires on every
 *     mutation, debounced through FileManager's existing pipeline.
 *
 *   - **External toggle** (`registerToggleRightSidebar` /
 *     `toggleRightSidebarExternal`) — the application menu and tray
 *     entry need to flip the sidebar from outside React.
 *
 * Lives at `src/browser/` (NOT under `react/`) so the architectural
 * rule — *core/managers never import React* — holds cleanly:
 * `BridgeListeners` and `FileManager` import this neutral seam,
 * `UIStateContext` (React) imports the same seam plus the internal
 * helpers to plug its state in at mount. Same pattern as
 * `src/browser/notify.ts` and `src/browser/toolConfirm.ts`.
 */

const currentMirror: AssistantViewState = { sidebarOpen: false, size: 20 };
let restoreHandler: ((state: AssistantViewState) => void) | null = null;
let changeListener: (() => void) | null = null;
let externalToggle: (() => void) | null = null;

// ---- Public surface (managers + composition root) -------------------

/**
 * Fresh snapshot of the current sidebar view state for persistence.
 * Returns a copy so callers can't mutate the internal mirror.
 */
export function getCurrentAssistantState(): AssistantViewState {
  return { sidebarOpen: currentMirror.sidebarOpen, size: currentMirror.size };
}

/**
 * Restore-side push — BridgeListeners calls this on
 * `from:session:restore`. No-op when the React provider hasn't
 * mounted yet (pre-mount events are dropped harmlessly).
 */
export function applyRestoredAssistantState(state: AssistantViewState): void {
  restoreHandler?.(state);
}

/**
 * Register a callback to fire on every sidebar state mutation
 * (open/close, resize). The composition root wires this to a
 * debounced session-save trigger.
 */
export function registerAssistantStateChangeListener(fn: () => void): void {
  changeListener = fn;
}

export function clearAssistantStateChangeListener(): void {
  changeListener = null;
}

/**
 * Wire a non-React caller to the sidebar toggle (used by the
 * application menu's View → Toggle Assistant Sidebar entry and
 * the system tray). Registered by the React provider at mount.
 */
export function registerToggleRightSidebar(fn: () => void): void {
  externalToggle = fn;
}

/**
 * Invoke the registered toggle. No-op pre-mount.
 */
export function toggleRightSidebarExternal(): void {
  externalToggle?.();
}

// ---- Internal helpers consumed by `<UIStateProvider>` ----------------
//
// Underscore-prefixed names signal "wire only — don't call from
// managers". The React provider uses these to plug its state /
// setters into the seam without exposing the private fields.

/** Provider mount effect: hand the restore-side setter up. */
export function _setRestoreHandler(
  fn: ((state: AssistantViewState) => void) | null,
): void {
  restoreHandler = fn;
}

/** Provider effect: keep the mirror in sync with the latest React state. */
export function _syncMirror(state: AssistantViewState): void {
  currentMirror.sidebarOpen = state.sidebarOpen;
  currentMirror.size = state.size;
}

/** Provider mutators: notify the registered change listener (if any). */
export function _notifyAssistantStateChange(): void {
  changeListener?.();
}
