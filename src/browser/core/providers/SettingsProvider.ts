import { editor } from 'monaco-editor';
import type { EditorSettings, SettingsFile } from '../../interfaces/Editor';
import { settings } from '../../config';

type PersistHandler = (next: Partial<SettingsFile>) => void;

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
  private currentSettings: EditorSettings = { ...settings };

  /** Stable snapshot returned by getSnapshot — rebuilt only on emit. */
  private snapshot: EditorSettings = this.currentSettings;

  /** Listeners registered through `subscribe`. */
  private listeners = new Set<() => void>();

  /**
   * Desktop persist handler, registered by the composition root
   * once BridgeManager exists.
   */
  private persistHandler: PersistHandler | null = null;

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
  public getSnapshot(): EditorSettings {
    return this.snapshot;
  }

  private emit() {
    // Recompute the snapshot reference so React's `===` check fires.
    this.snapshot = { ...this.currentSettings };
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
    this.currentSettings = { ...next };
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
    return settings;
  }

  public setDefaultSettings() {
    this.currentSettings = { ...settings };
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
      systemtheme: () => this.setSystemThemeOverride(),
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
    this.snapshot = { ...this.currentSettings };
  }

  private loadSettingsFromLocalStorage() {
    const storage = localStorage.getItem('mkeditor-settings');
    if (!storage) {
      this.setDefaultSettings();
      this.updateSettingsInLocalStorage();
      return;
    }
    try {
      const parsed = JSON.parse(storage) as Partial<EditorSettings> | null;
      if (typeof parsed !== 'object' || parsed === null) {
        // Corrupted shape — reset to defaults + persist.
        this.setDefaultSettings();
        this.updateSettingsInLocalStorage();
        return;
      }
      // Merge stored values onto current defaults so any new fields added
      // in later versions (e.g. `sessionRestore` in 3.8) inherit their
      // default rather than landing as `undefined` and breaking React
      // controls / the gate getter. Stored values still take precedence
      // for every key the user has actually customised.
      this.currentSettings = { ...settings, ...parsed };
      // If the merge filled in any missing keys, persist the upgraded
      // shape so future loads don't repeat the work.
      const upgraded = Object.keys(settings).some((k) => !(k in parsed));
      if (upgraded) this.updateSettingsInLocalStorage();
    } catch {
      this.setDefaultSettings();
      this.updateSettingsInLocalStorage();
    }
  }

  private updateSettingsInLocalStorage() {
    localStorage.setItem(
      'mkeditor-settings',
      JSON.stringify(this.currentSettings),
    );
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
    document.body.setAttribute(
      'data-theme',
      this.currentSettings.darkmode ? 'dark' : 'light',
    );
    editor.setTheme(this.currentSettings.darkmode ? 'vs-dark' : 'vs');
    return this;
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
