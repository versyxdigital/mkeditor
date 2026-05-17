import { ipcMain, type BrowserWindow } from 'electron';

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
 */
export class AppWindow {
  private context: BrowserWindow;

  constructor(context: BrowserWindow, register = false) {
    this.context = context;
    if (register) this.register();
  }

  register() {
    ipcMain.on('to:window:minimize', () => {
      if (this.context.isDestroyed()) return;
      this.context.minimize();
    });

    ipcMain.on('to:window:maximize', () => {
      if (this.context.isDestroyed()) return;
      if (this.context.isMaximized()) {
        this.context.unmaximize();
      } else {
        this.context.maximize();
      }
    });

    ipcMain.on('to:window:close', () => {
      if (this.context.isDestroyed()) return;
      this.context.close();
    });

    this.context.on('maximize', () => this.emitState(true));
    this.context.on('unmaximize', () => this.emitState(false));

    // Hydrate the renderer with the current state once the renderer is
    // ready to receive (mirrors the other `did-finish-load` sends in
    // `main.ts`). Without this the maximize icon would render in the
    // wrong state on reload.
    this.context.webContents.once('did-finish-load', () => {
      this.emitState(this.context.isMaximized());
    });
  }

  private emitState(isMaximized: boolean): void {
    if (this.context.isDestroyed()) return;
    this.context.webContents.send('from:window:state', { isMaximized });
  }
}
