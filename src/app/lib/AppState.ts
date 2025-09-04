import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, normalize } from 'path';
import { pathToFileURL } from 'url';
import type { BrowserWindow } from 'electron';
import type { LogConfig } from '../interfaces/Logging';
import type { RecentEntry, RecentType, StateFile } from '../interfaces/State';
import { deepMerge, hasAllKeys } from '../util';

const defaultState: StateFile = {
  recent: { entries: [] },
};

/**
 * AppState
 */
export class AppState {
  /** The browser window */
  private context: BrowserWindow;

  /** Application state dir path */
  private appPath: string;

  /** Application state file path */
  private filePath: string;

  /** Has been newly created with defaults */
  private isNewFile: boolean = false;

  /** Logger */
  private logger: LogConfig;

  /** Default editor state */
  private state: StateFile = {
    recent: { entries: [] },
  };

  /** Quick flag to check state enabled/disabled */
  private enabled: boolean = true;

  /** Change listeners */
  private listeners: Set<() => void> = new Set();

  /**
   * Create a new app state handler.
   *
   * @param context - the browser window
   * @returns
   */
  constructor(context: BrowserWindow, logger: LogConfig) {
    this.context = context;
    this.logger = logger;
    this.appPath = normalize(homedir() + '/.mkeditor/');
    this.filePath = this.appPath + 'state.json';

    // Create the file if it doesn't exist, then load it.
    this.createFileIfNotExists();
    const loaded = this.loadFile() as StateFile;

    // Check for state file integrity
    if (!this.isNewFile && !hasAllKeys(this.state, loaded)) {
      this.saveStateToFile(deepMerge(this.state, loaded));
    }

    // Set the applied state for this session.
    this.state = loaded;
  }

  /**
   * Set state enabled or disabled.
   *
   * @param enabled - boolean to toggle state
   * @returns
   */
  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.logger.log.info('state is now enabled...');
  }

  /**
   * Get the state.
   *
   * @returns - the app state
   */
  public getState() {
    return this.state;
  }

  /**
   * Get recent items sorted by last opened.
   *
   * @returns
   */
  public getRecent(): RecentEntry[] {
    return [...(this.state.recent.entries || [])].sort(
      (a, b) => (b.lastOpened || 0) - (a.lastOpened || 0),
    );
  }

  /**
   * Clear recent items.
   *
   * @returns
   */
  public clearRecent() {
    this.state.recent.entries = [];
    this.saveStateToFile(this.state);
    this.dispatchStateChange();
  }

  /**
   * Add a file/folder path to recent items.
   *
   * @param path - the path to the file/folder
   * @param type - whether it's a file or folder
   * @returns
   */
  public addRecentPath(path: string, type: RecentType) {
    if (!this.enabled) return;
    try {
      const uri = pathToFileURL(path).toString();
      const label = basename(path);
      const now = Date.now();
      // De-duplicate by uri
      const entries = this.state.recent.entries || [];
      const idx = entries.findIndex((e) => e.uri === uri);
      if (idx >= 0) {
        entries[idx] = { ...entries[idx], lastOpened: now, type, label };
      } else {
        entries.unshift({ type, uri, label, lastOpened: now });
      }
      // Trim to a reasonable max length
      this.state.recent.entries = entries.slice(0, 20);
      this.saveStateToFile(this.state);
      this.dispatchStateChange();
    } catch {
      // no-op
    }
  }

  /**
   * Subscribe to state changes.
   * Returns an unsubscribe function.
   */
  public onDidStateChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Load state file.
   * @returns - the state
   */
  loadFile() {
    try {
      const file = readFileSync(this.filePath, {
        encoding: 'utf-8',
      });

      return JSON.parse(file);
    } catch (err) {
      this.context.webContents.send('from:notification:display', {
        status: 'error',
        key: 'notifications:state_file_corrupted_reset',
      });

      return defaultState;
    }
  }

  /**
   * Create the state file if it doesn't exist.
   *
   * @param state - the state to save
   * @returns
   */
  createFileIfNotExists() {
    if (!existsSync(this.appPath)) {
      mkdirSync(this.appPath);
    }

    if (!existsSync(this.filePath)) {
      this.saveStateToFile(defaultState);
      this.isNewFile = true;
    }
  }

  /**
   * Save current state to the state file.
   *
   * @param state - the state to save
   * @returns
   */
  saveStateToFile(state: Partial<StateFile>) {
    try {
      const base = existsSync(this.filePath)
        ? (this.loadFile() as StateFile)
        : this.state;

      const updated: StateFile = {
        ...base,
        ...state,
      };

      writeFileSync(this.filePath, JSON.stringify(updated, null, 4), {
        encoding: 'utf-8',
      });

      this.state = updated;
    } catch (err) {
      const detail = err as { code: string };
      const key =
        detail.code === 'EPERM'
          ? 'notifications:unable_save_state_permission_denied'
          : 'notifications:unable_save_state_unknown_error';

      this.logger.log.error(key, err);

      this.context.webContents.send('from:notification:display', {
        status: 'error',
        key,
      });
    }
  }

  /**
   * Emit the state change.
   */
  private dispatchStateChange() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        this.logger.log.error(
          'Unable to emit recent items state update event.',
        );
      }
    });
  }
}
