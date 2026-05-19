/**
 * Menu model — single source of truth for the application menu.
 *
 * Consumed by:
 *   - `AppMenu` (same directory) — builds an Electron `Menu` from this
 *     model on macOS.
 *   - `<TitleBar>` (renderer, `src/browser/react/`) — renders a Radix
 *     `<DropdownMenu>` from the same model on Windows/Linux/web. The
 *     renderer reaches across via webpack at `../../app/lib/menuModel`;
 *     it lives here (rather than under `src/browser/`) because
 *     `src/app/tsconfig.json` excludes the browser tree, so the main
 *     process can't import from it.
 *
 * This file carries no Electron runtime imports so it stays consumable
 * from either side.
 */

/** Standard Electron role names we use. Expressed as a plain string union
 *  so we don't pull in `@types/electron`. `AppMenu` coerces these to the
 *  Electron type at build time. */
export type MenuRole =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'togglefullscreen'
  | 'quit';

export type MenuAction =
  /** Send a `from:*` channel from main to renderer (used by the macOS
   *  native menu). On Windows/Linux in P2 the renderer's in-window menu
   *  will dispatch the same channel name through its own BridgeListener
   *  surface. */
  | { kind: 'channel'; channel: string; payload?: unknown }
  /** Use Electron's built-in role. The Electron menu honours the OS's
   *  default label (e.g. "Exit" on Windows for `quit`). */
  | { kind: 'role'; role: MenuRole }
  /** Run a main-process command by id (e.g. open the log file, toggle
   *  DevTools). Handlers live in `AppMenu` for macOS today; P2 adds a
   *  `to:command:run` IPC so the renderer menu can reach them. */
  | { kind: 'command'; commandId: string };

export interface MenuItem {
  /** Stable id for tests, keyboard nav, and the i18n key (`menu.<id>`). */
  id: string;
  /** English label. The renderer translates via `t(\`menu.\${id}\`)` once
   *  i18n is wired in P2 and falls back to this string. For `role` actions
   *  `AppMenu` deliberately omits this — Electron picks the OS default. */
  label: string;
  /** Default Electron accelerator string. Use the `CmdOrCtrl+` modifier
   *  to mean Cmd on macOS and Ctrl elsewhere — Electron resolves it at
   *  runtime, and the renderer reads the same syntax in P2 (where we'll
   *  expand it using the runtime `mode` flag from `Managers`). */
  accelerator?: string;
  /** Overrides `accelerator` on macOS. Use only when the platforms can't
   *  share a single `CmdOrCtrl+` expression (e.g. DevTools, where macOS
   *  uses `Alt+Cmd+I` and Windows/Linux uses `Ctrl+Shift+I`). */
  darwinAccelerator?: string;
  /** What clicking the item does. */
  action?: MenuAction;
  /** Render a separator above this item. */
  separatorBefore?: boolean;
}

export interface MenuGroup {
  id: 'file' | 'edit' | 'view' | 'help';
  /** English label shown on the menu-bar button. */
  label: string;
  items: MenuItem[];
}

export type MenuModel = MenuGroup[];

export const menuModel: MenuModel = [
  {
    id: 'file',
    label: 'File',
    items: [
      {
        id: 'file.new',
        label: 'New File...',
        accelerator: 'CmdOrCtrl+N',
        action: {
          kind: 'channel',
          channel: 'from:file:new',
          payload: 'to:file:new',
        },
      },
      {
        id: 'file.open',
        label: 'Open File...',
        accelerator: 'CmdOrCtrl+O',
        action: {
          kind: 'channel',
          channel: 'from:file:open',
          payload: 'to:file:open',
        },
      },
      {
        id: 'folder.open',
        label: 'Open Folder...',
        accelerator: 'CmdOrCtrl+Shift+O',
        action: {
          kind: 'channel',
          channel: 'from:folder:open',
          payload: 'to:folder:open',
        },
      },
      {
        id: 'file.save',
        label: 'Save',
        accelerator: 'CmdOrCtrl+S',
        action: {
          kind: 'channel',
          channel: 'from:file:save',
          payload: 'to:file:save',
        },
      },
      {
        id: 'file.saveas',
        label: 'Save As...',
        accelerator: 'CmdOrCtrl+Shift+S',
        action: {
          kind: 'channel',
          channel: 'from:file:saveas',
          payload: 'to:file:saveas',
        },
      },
      {
        id: 'file.settings',
        label: 'Settings...',
        separatorBefore: true,
        action: {
          kind: 'channel',
          channel: 'from:modal:open',
          payload: 'settings',
        },
      },
      {
        id: 'file.openlog',
        label: 'Open Log...',
        action: { kind: 'command', commandId: 'open-log' },
      },
      {
        id: 'file.quit',
        label: 'Quit',
        separatorBefore: true,
        action: { kind: 'role', role: 'quit' },
      },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [
      {
        id: 'edit.undo',
        label: 'Undo',
        action: { kind: 'role', role: 'undo' },
      },
      {
        id: 'edit.redo',
        label: 'Redo',
        action: { kind: 'role', role: 'redo' },
      },
      {
        id: 'edit.cut',
        label: 'Cut',
        separatorBefore: true,
        action: { kind: 'role', role: 'cut' },
      },
      {
        id: 'edit.copy',
        label: 'Copy',
        action: { kind: 'role', role: 'copy' },
      },
      {
        id: 'edit.paste',
        label: 'Paste',
        action: { kind: 'role', role: 'paste' },
      },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: [
      {
        id: 'view.palette',
        label: 'Open Command Palette',
        accelerator: 'F1',
        action: {
          kind: 'channel',
          channel: 'from:command:palette',
          payload: 'open',
        },
      },
      {
        id: 'view.fullscreen',
        label: 'Toggle Full Screen',
        separatorBefore: true,
        action: { kind: 'role', role: 'togglefullscreen' },
      },
      {
        id: 'view.assistant.toggle',
        label: 'Toggle Assistant Sidebar',
        accelerator: 'CmdOrCtrl+Shift+A',
        separatorBefore: true,
        // Desktop-only. The in-window `<TitleBar>` menu skips this
        // entry on web (and main never builds an Electron menu
        // there anyway). Channel routes through BridgeListeners →
        // UIStateContext.
        action: {
          kind: 'channel',
          channel: 'from:assistant:toggle',
        },
      },
      {
        id: 'view.devtools',
        label: 'Toggle Developer Tools',
        accelerator: 'Ctrl+Shift+I',
        darwinAccelerator: 'Alt+Cmd+I',
        action: { kind: 'command', commandId: 'toggle-devtools' },
      },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    items: [
      {
        id: 'help.about',
        label: 'About MKEditor',
        // No accelerator: Cmd/Ctrl+/ is the chat input-focus
        // shortcut. About is still reachable from the menu.
        action: {
          kind: 'channel',
          channel: 'from:modal:open',
          payload: 'about',
        },
      },
      {
        id: 'help.shortcuts',
        label: 'Editor Shortcuts',
        accelerator: 'CmdOrCtrl+;',
        action: {
          kind: 'channel',
          channel: 'from:modal:open',
          payload: 'shortcuts',
        },
      },
      {
        id: 'help.assistant.configure',
        label: 'Configure AI Providers...',
        separatorBefore: true,
        // Opens the Settings modal directly on the AI Providers
        // tab. Renderer (BridgeListeners + MenuActionBridge) reads
        // the payload's `tab` field and forwards it to
        // `openModalExternal('settings', { tab: 'assistant' })`.
        action: {
          kind: 'channel',
          channel: 'from:modal:open',
          payload: { modal: 'settings', tab: 'assistant' },
        },
      },
    ],
  },
];
