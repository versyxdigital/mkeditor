import type { editor } from 'monaco-editor';
import { applyEditorTheme } from '../editorTheme';
import type {
  EditorSettings,
  EditorSettingsSnapshot,
  SettingsFile,
} from '../../interfaces/Editor';
import { settings } from '../../config';
import { logger } from '../../util';

type PersistHandler = (next: Partial<SettingsFile>) => void;

function normalizeSettings(value: unknown): EditorSettings {
  const next: EditorSettings = {
    ...settings,
    fileExplorer: { extensions: [...settings.fileExplorer.extensions] },
    pasteImages: { ...settings.pasteImages },
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return next;
  const stored = value as Partial<EditorSettings>;
  const booleanKeys = [
    'autoindent',
    'darkmode',
    'wordwrap',
    'whitespace',
    'minimap',
    'systemtheme',
    'scrollsync',
    'sessionRestore',
    'assistantAutoOpenFiles',
    'editorVisible',
  ] as const;
  for (const key of booleanKeys) {
    if (typeof stored[key] === 'boolean') next[key] = stored[key];
  }
  if (typeof stored.locale === 'string' && stored.locale)
    next.locale = stored.locale;
  if (Array.isArray(stored.fileExplorer?.extensions)) {
    next.fileExplorer.extensions = stored.fileExplorer.extensions.filter(
      (extension): extension is string => typeof extension === 'string',
    );
  }
  if (typeof stored.pasteImages?.directory === 'string') {
    next.pasteImages.directory = stored.pasteImages.directory;
  }
  return next;
}

/**
 * Settings data + IPC owner. The provider exposes a stable
 * snapshot + `subscribe` pair that <SettingsContext> consumes
 * via `useSyncExternalStore`. React components drive every change
 * through `updateSetting(key, value)`, which: (1) writes state,
 * (2) applies the Monaco / theme side effect, (3) emits to subscribers,
 * and (4) persists to localStorage / bridge.
 */
export class SettingsProvider {
  /** Execution mode */
  private mode: 'web' | 'desktop' = 'web';

  /** Editor instance */
  private mkeditor: editor.IStandaloneCodeEditor;

  /** Editor settings */
  private currentSettings: EditorSettings = normalizeSettings(null);

  /** Stable snapshot returned by getSnapshot — rebuilt only on emit. */
  private snapshot: EditorSettingsSnapshot = {
    ...this.currentSettings,
    effectiveDarkmode: this.currentSettings.darkmode,
  };

  /** Listeners registered through `subscribe`. */
  private listeners = new Set<() => void>();

  /**
   * Desktop persist handler, registered by the composition root
   * once BridgeManager exists.
   */
  private persistHandler: PersistHandler | null = null;

  /**
   * Current OS theme (Windows / macOS / GNOME). Populated by
   * `from:theme:set` at boot and on every `nativeTheme.on('updated')`
   * event.
   */
  private osDarkmode: boolean | null = null;

  /**
   * Create a new editor settings handler.
   */
  public constructor(
    mode: 'web' | 'desktop' = 'web',
    mkeditor: editor.IStandaloneCodeEditor,
  ) {
    this.mode = mode;
    this.mkeditor = mkeditor;

    this.loadSettings();
  }

  // ---------------------------------------------------------------------
  // Observable surface (consumed by SettingsContext)
  // ---------------------------------------------------------------------

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Returns the same object reference between emits (useSyncExternalStore contract). */
  public getSnapshot(): EditorSettingsSnapshot {
    return this.snapshot;
  }

  private emit() {
    // Recompute the snapshot reference so React's `===` check fires.
    this.snapshot = {
      ...this.currentSettings,
      effectiveDarkmode: this.effectiveDarkmode(),
    };
    this.listeners.forEach((l) => l());
  }

  // ---------------------------------------------------------------------
  // Mode + defaults + getters/setters
  // ---------------------------------------------------------------------

  public setAppMode(mode: 'web' | 'desktop') {
    this.mode = mode;
  }

  public getMode(): 'web' | 'desktop' {
    return this.mode;
  }

  public getSettings() {
    return this.currentSettings;
  }

  public getSetting<K extends keyof EditorSettings>(key: K) {
    return this.currentSettings[key];
  }

  public setSettings(next: EditorSettings) {
    this.currentSettings = normalizeSettings(next);
    this.applyAll();
    this.emit();
  }

  public setSetting<K extends keyof EditorSettings>(
    key: K,
    value: EditorSettings[K],
  ) {
    this.currentSettings[key] = value;
  }

  public getDefaultSettings() {
    return normalizeSettings(null);
  }

  public setDefaultSettings() {
    this.currentSettings = normalizeSettings(null);
  }

  // ---------------------------------------------------------------------
  // React-facing entrypoint: state + apply + emit + persist
  // ---------------------------------------------------------------------

  /**
   * Update a single setting. This is the single call the React modal
   * makes on every form change. It writes state, runs the matching
   * Monaco / theme side effect, emits to listeners, and persists.
   */
  public updateSetting<K extends keyof EditorSettings>(
    key: K,
    value: EditorSettings[K],
  ) {
    this.currentSettings[key] = value;
    this.applyOne(key);
    this.emit();
    this.persist();
  }

  /** Apply Monaco / theme side effects for one setting key. */
  private applyOne<K extends keyof EditorSettings>(key: K) {
    const handlers: Partial<Record<keyof EditorSettings, () => void>> = {
      autoindent: () => this.setAudoIndent(),

      darkmode: () => this.setTheme(),

      minimap: () => this.setMinimap(),

      wordwrap: () => this.setWordWrap(),

      whitespace: () => this.setWhitespace(),

      systemtheme: () => this.setTheme(),

      // scrollsync has no editor option — checked at scroll time.
      locale: () => window.setLanguage(this.currentSettings.locale),
    };
    handlers[key]?.();
  }

  /** Apply every side-effecting setting (used after setSettings(...)). */
  private applyAll() {
    this.setTheme()
      .setAudoIndent()
      .setMinimap()
      .setWhitespace()
      .setWordWrap()
      .setSystemThemeOverride();
  }

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------

  /**
   * Load editor settings (web: from localStorage; desktop: settings come
   * later via `from:settings:set` over the bridge). Applies all
   * side-effecting settings to Monaco after load.
   */
  private loadSettings() {
    if (this.mode === 'web') {
      this.loadSettingsFromLocalStorage();
    }
    this.applyAll();
    // useSyncExternalStore reads the first snapshot synchronously, so
    // we have to refresh `this.snapshot` after loadSettingsFromLocalStorage
    // swaps `this.currentSettings`. Without this the React contexts see
    // the original defaults snapshot on first render and the controls
    // render as "off" even though the underlying settings are loaded.
    this.snapshot = {
      ...this.currentSettings,
      effectiveDarkmode: this.effectiveDarkmode(),
    };
  }

  private loadSettingsFromLocalStorage() {
    try {
      const storage = localStorage.getItem('mkeditor-settings');
      const parsed: unknown = storage ? JSON.parse(storage) : null;
      this.currentSettings = normalizeSettings(parsed);
      if (JSON.stringify(parsed) !== JSON.stringify(this.currentSettings)) {
        this.updateSettingsInLocalStorage();
      }
    } catch {
      this.setDefaultSettings();
      this.updateSettingsInLocalStorage();
    }
  }

  private updateSettingsInLocalStorage() {
    try {
      localStorage.setItem(
        'mkeditor-settings',
        JSON.stringify(this.currentSettings),
      );
    } catch (error) {
      logger.warn('Unable to persist editor settings', error);
    }
  }

  public setPersistHandler(fn: PersistHandler | null) {
    this.persistHandler = fn;
  }

  /** Persist via localStorage (web) or the IPC bridge (desktop). */
  private persist() {
    if (this.mode === 'web') {
      this.updateSettingsInLocalStorage();
    } else {
      this.persistHandler?.(this.currentSettings);
    }
  }

  // ---------------------------------------------------------------------
  // Monaco / theme applicators
  // ---------------------------------------------------------------------

  public setAudoIndent() {
    this.mkeditor.updateOptions({
      autoIndent: this.currentSettings.autoindent ? 'advanced' : 'none',
    });
    return this;
  }

  public setTheme() {
    const effective = this.effectiveDarkmode();
    document.body.setAttribute('data-theme', effective ? 'dark' : 'light');
    applyEditorTheme(effective);
    return this;
  }

  /**
   * Theme actually rendered to the DOM + Monaco.
   */
  private effectiveDarkmode(): boolean {
    if (this.currentSettings.systemtheme && this.osDarkmode !== null) {
      return this.osDarkmode;
    }
    return this.currentSettings.darkmode;
  }

  /**
   * Update the cached OS theme and re-apply the effective theme.
   */
  public setOsDarkmode(value: boolean): void {
    if (this.osDarkmode === value) return;
    this.osDarkmode = value;
    if (this.currentSettings.systemtheme) {
      this.setTheme();
      this.emit();
    }
  }

  /** Test/inspection helper — read the current OS darkmode cache. */
  public getOsDarkmode(): boolean | null {
    return this.osDarkmode;
  }

  public setMinimap() {
    this.mkeditor.updateOptions({
      minimap: { enabled: this.currentSettings.minimap },
    });
    return this;
  }

  public setWordWrap() {
    this.mkeditor.updateOptions({
      wordWrap: this.currentSettings.wordwrap ? 'on' : 'off',
    });
    return this;
  }

  public setWhitespace() {
    this.mkeditor.updateOptions({
      renderWhitespace: this.currentSettings.whitespace ? 'all' : 'none',
    });
    return this;
  }

  public setSystemThemeOverride() {
    // No DOM mutation requiredm, the modal's React UI reads
    // `systemtheme` from SettingsContext and disables the darkmode
    // toggle conditionally. Kept as a no-op method so the public
    // surface listed in the migration doc still resolves.
    return this;
  }
}
