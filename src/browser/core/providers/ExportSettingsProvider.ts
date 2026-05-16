import type { ExportSettings, SettingsFile } from '../../interfaces/Editor';
import { exportSettings as defaults } from '../../config';
import { syncPreviewToExportSettings } from '../../util';
import { dom } from '../../dom';

type PersistHandler = (next: Partial<SettingsFile>) => void;

/**
 * Export-settings data + IPC owner. Phase 7 strips this of DOM
 * responsibilities — `registerDOMListeners`, `setUIState`,
 * `isApplying` are all gone. React's <ExportSettingsModal> reads
 * from the snapshot via `subscribe`/`getSnapshot` and drives changes
 * through `updateSetting(key, value)` (or `setSettings(...)` for
 * batch loads coming from the bridge).
 *
 * Persistence stays debounced (250ms for most settings, 400ms for the
 * line-spacing slider) and dedupes against `lastPersistedJSON`.
 *
 * The live preview style sync still happens on every state change —
 * after Phase 7 we run it from `applyAll()` instead of `setUIState()`.
 */
export class ExportSettingsProvider {
  private mode: 'web' | 'desktop' = 'web';
  private currentSettings: ExportSettings = { ...defaults };

  /** Stable snapshot for useSyncExternalStore consumers. */
  private snapshot: ExportSettings = this.currentSettings;
  private listeners = new Set<() => void>();

  private saveTimer: number | null = null;
  private debounceMs = 250;
  private lastPersistedJSON = '';

  /**
   * Desktop persist handler — registered by the composition root once
   * BridgeManager exists. Phase 9 replaced the dispatcher's
   * `editor:bridge:settings` event with a direct call here.
   */
  private persistHandler: PersistHandler | null = null;

  constructor(mode: 'web' | 'desktop') {
    this.mode = mode;
    this.loadSettings();
  }

  public setPersistHandler(fn: PersistHandler | null) {
    this.persistHandler = fn;
  }

  // ---------------------------------------------------------------------
  // Observable surface
  // ---------------------------------------------------------------------

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): ExportSettings {
    return this.snapshot;
  }

  private emit() {
    this.snapshot = { ...this.currentSettings };
    this.listeners.forEach((l) => l());
  }

  // ---------------------------------------------------------------------
  // Mode + defaults + getters/setters
  // ---------------------------------------------------------------------

  public getDefaultSettings() {
    return {
      withStyles: true,
      container: 'container-fluid',
      fontSize: 16,
      lineSpacing: 1.5,
      background: '#ffffff',
      fontColor: '#212529',
    } as ExportSettings;
  }

  public getSettings() {
    return this.currentSettings;
  }

  /** Apply a complete settings object (e.g., from `from:settings:set`). */
  public setSettings(next: ExportSettings) {
    this.currentSettings = { ...next };
    this.applyPreviewSync();
    this.emit();
  }

  // ---------------------------------------------------------------------
  // React-facing entrypoints: state + apply + emit + persist
  // ---------------------------------------------------------------------

  /**
   * Update a single setting. Drives the live preview sync, emits to
   * SettingsContext subscribers, and schedules a debounced persist.
   * `lineSpacing` gets a longer debounce (400ms) to suit slider drag.
   */
  public updateSetting<K extends keyof ExportSettings>(
    key: K,
    value: ExportSettings[K],
  ) {
    this.currentSettings[key] = value;
    this.applyPreviewSync();
    this.emit();
    this.schedule(key === 'lineSpacing' ? 400 : undefined);
  }

  private applyPreviewSync() {
    syncPreviewToExportSettings(this.currentSettings, dom.preview.dom);
  }

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------

  private loadSettings() {
    if (this.mode === 'web') {
      const storage = localStorage.getItem('mkeditor-export-settings');
      if (storage) {
        try {
          this.currentSettings = JSON.parse(storage) as ExportSettings;
        } catch {
          this.currentSettings = { ...defaults };
          this.updateSettingsInLocalStorage();
        }
      } else {
        this.updateSettingsInLocalStorage();
      }
    }
    this.applyPreviewSync();
    this.snapshot = { ...this.currentSettings };
  }

  public updateSettingsInLocalStorage() {
    localStorage.setItem(
      'mkeditor-export-settings',
      JSON.stringify(this.currentSettings),
    );
  }

  /** Schedule a debounced persist (250ms default, 400ms for the slider). */
  private schedule(overrideDelay?: number) {
    const delay = overrideDelay ?? this.debounceMs;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, delay);
  }

  /** Persist if the serialised settings actually changed. */
  private save() {
    const nextJSON = JSON.stringify(this.currentSettings);
    if (nextJSON === this.lastPersistedJSON) return;

    if (this.mode === 'web') {
      this.updateSettingsInLocalStorage();
    } else {
      this.persistHandler?.({ exportSettings: this.currentSettings });
    }

    this.lastPersistedJSON = nextJSON;
  }
}
