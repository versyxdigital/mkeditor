import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron';

/**
 * AppWindow
 *
 * Owns the window-control IPC surface used by the renderer's in-window
 * title bar (added in P2). Three inbound channels drive the BrowserWindow
 * directly (`minimize`, `maximize` toggle, `close`); one outbound channel
 * (`from:window:state`) keeps the renderer's max/restore icon in sync
 * with the actual window state — fires on initial load and on every
 * `maximize` / `unmaximize` event.
 *
 * On macOS the native traffic lights handle these actions themselves
 * (we keep `titleBarStyle: 'hiddenInset'` so they stay visible); the
 * channels are still registered, harmlessly, since the renderer never
 * sends to them on darwin.
 *
 * **Listener hygiene.** Each `ipcMain.on` registration is process-
 * global, so on macOS where the window can be recreated via
 * `app.on('activate')`, we have to do two things to avoid leaking and
 * cross-window dispatch:
 *   1. Sender-scope every handler — ignore events whose sender's
 *      webContents id doesn't match this window's. Stops a second
 *      window from acting on the first window's IPC traffic.
 *   2. Track each registered handler and remove it via
 *      `ipcMain.removeListener` when the window emits `closed`. Stops
 *      orphan handlers from accumulating across recreations.
 */
export class AppWindow {
  private context: BrowserWindow;
  /** Tracked so `closed` can remove exactly the handlers we added. */
  private listeners: Array<{ channel: string; handler: (...args: unknown[]) => void }> = [];

  constructor(context: BrowserWindow, register = false) {
    this.context = context;
    if (register) this.register();
  }

  register() {
    this.on('to:window:minimize', () => {
      if (this.context.isDestroyed()) return;
      this.context.minimize();
    });

    this.on('to:window:maximize', () => {
      if (this.context.isDestroyed()) return;
      if (this.context.isMaximized()) {
        this.context.unmaximize();
      } else {
        this.context.maximize();
      }
    });

    this.on('to:window:close', () => {
      if (this.context.isDestroyed()) return;
      this.context.close();
    });

    // Native `role: 'togglefullscreen'` accelerators only fire when the
    // application menu is mounted — Windows/Linux clear the menu in P1,
    // so the renderer's in-window menu drives this IPC instead.
    this.on('to:window:fullscreen', () => {
      if (this.context.isDestroyed()) return;
      this.context.setFullScreen(!this.context.isFullScreen());
    });

    // Edit-menu clipboard actions. Native `role: 'cut'` etc. accelerators
    // are also dead without the application menu mounted. Going through
    // `document.execCommand` from the renderer fails because Radix's
    // deferred close + setTimeout consumes the "transient user activation"
    // gesture Chromium requires for clipboard ops. `webContents.cut()`
    // etc. dispatch the events natively without that constraint —
    // Monaco's textarea receives them and acts accordingly.
    this.on('to:edit:cut', () => {
      if (this.context.isDestroyed()) return;
      this.context.webContents.cut();
    });
    this.on('to:edit:copy', () => {
      if (this.context.isDestroyed()) return;
      this.context.webContents.copy();
    });
    this.on('to:edit:paste', () => {
      if (this.context.isDestroyed()) return;
      this.context.webContents.paste();
    });

    this.context.on('maximize', () => this.emitState(true));
    this.context.on('unmaximize', () => this.emitState(false));

    // Tear down IPC listeners when this window closes so we don't leak
    // handlers (macOS recreates the window via `app.on('activate')`)
    // or dispatch onto a destroyed BrowserWindow.
    this.context.once('closed', () => this.dispose());

    // Hydrate the renderer with the current state once the renderer is
    // ready to receive (mirrors the other `did-finish-load` sends in
    // `main.ts`). Without this the maximize icon would render in the
    // wrong state on reload.
    this.context.webContents.once('did-finish-load', () => {
      this.emitState(this.context.isMaximized());
    });
  }

  /**
   * Register an IPC listener scoped to this window's webContents. The
   * handler runs only when the event originated from our renderer —
   * a second BrowserWindow's traffic is ignored. The wrapper is
   * tracked so `dispose()` can remove the exact reference.
   */
  private on(channel: string, fn: (event: IpcMainEvent) => void): void {
    const handler = (event: IpcMainEvent) => {
      if (event.sender.id !== this.context.webContents.id) return;
      fn(event);
    };
    ipcMain.on(channel, handler);
    this.listeners.push({ channel, handler: handler as (...args: unknown[]) => void });
  }

  private dispose(): void {
    for (const { channel, handler } of this.listeners) {
      ipcMain.removeListener(channel, handler);
    }
    this.listeners = [];
  }

  private emitState(isMaximized: boolean): void {
    if (this.context.isDestroyed()) return;
    this.context.webContents.send('from:window:state', { isMaximized });
  }
}
