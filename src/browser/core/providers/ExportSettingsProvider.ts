import type { ExportSettings, SettingsFile } from '../../interfaces/Editor';
import { exportSettings as defaults } from '../../config';
import { logger, syncPreviewToExportSettings } from '../../util';
import { dom } from '../../dom';

type PersistHandler = (next: Partial<SettingsFile>) => void;

function normalizeSettings(value: unknown): ExportSettings {
  const next = { ...defaults };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return next;
  const stored = value as Partial<ExportSettings>;
  if (typeof stored.withStyles === 'boolean') next.withStyles = stored.withStyles;
  if (stored.container === 'container' || stored.container === 'container-fluid') {
    next.container = stored.container;
  }
  for (const key of ['fontSize', 'lineSpacing'] as const) {
    const value = stored[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) next[key] = value;
  }
  for (const key of ['background', 'fontColor'] as const) {
    if (typeof stored[key] === 'string' && stored[key]) next[key] = stored[key];
  }
  return next;
}

/**
 * Export-settings data + IPC owner. React's <ExportSettingsModal> reads
 * from the snapshot via `subscribe`/`getSnapshot` and drives changes
 * through `updateSetting(key, value)` (or `setSettings(...)` for
 * batch loads coming from the bridge).
 *
 * Persistence stays debounced (250ms for most settings, 400ms for the
 * line-spacing slider) and dedupes against `lastPersistedJSON`.
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
   * Desktop persist handler, registered by the composition root
   * once BridgeManager exists.
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
    return { ...defaults };
  }

  public getSettings() {
    return this.currentSettings;
  }

  /** Apply a complete settings object (e.g., from `from:settings:set`). */
  public setSettings(next: ExportSettings) {
    this.currentSettings = normalizeSettings(next);
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
    const preview = dom.preview.dom;
    if (preview) syncPreviewToExportSettings(this.currentSettings, preview);
  }

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------

  private loadSettings() {
    if (this.mode === 'web') {
      try {
        const storage = localStorage.getItem('mkeditor-export-settings');
        const parsed: unknown = storage ? JSON.parse(storage) : null;
        this.currentSettings = normalizeSettings(parsed);
        if (JSON.stringify(parsed) !== JSON.stringify(this.currentSettings)) {
          this.updateSettingsInLocalStorage();
        }
      } catch {
        this.currentSettings = { ...defaults };
        this.updateSettingsInLocalStorage();
      }
    }
    this.applyPreviewSync();
    this.snapshot = { ...this.currentSettings };
  }

  public updateSettingsInLocalStorage(): boolean {
    try {
      localStorage.setItem(
        'mkeditor-export-settings',
        JSON.stringify(this.currentSettings),
      );
      return true;
    } catch (error) {
      logger.warn('Unable to persist export settings', error);
      return false;
    }
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
      if (!this.updateSettingsInLocalStorage()) return;
    } else {
      if (!this.persistHandler) return;
      this.persistHandler({ exportSettings: this.currentSettings });
    }

    this.lastPersistedJSON = nextJSON;
  }
}
