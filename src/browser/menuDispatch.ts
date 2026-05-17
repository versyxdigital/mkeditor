import type { MenuAction } from '../app/lib/menuModel';

/**
 * Module-level seam between the in-window menu (React `<TitleBar>`) and
 * the renderer side-effects each `MenuAction` triggers (channel sends,
 * Monaco command triggers, main-process command IPC).
 *
 * `<App>` installs the real dispatcher at mount time via
 * `registerMenuActionDispatcher` — same pattern as `openModalExternal`,
 * `confirmExternal`, etc. Until that happens (web mode before the
 * bridge boots, or the very first render) calls are dropped silently.
 */
export type MenuActionDispatcher = (action: MenuAction) => void;

let dispatcher: MenuActionDispatcher | null = null;

export function registerMenuActionDispatcher(fn: MenuActionDispatcher): void {
  dispatcher = fn;
}

export function dispatchMenuActionExternal(action: MenuAction): void {
  dispatcher?.(action);
}
