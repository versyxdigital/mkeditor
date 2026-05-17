import './icons';
import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { EditorDispatcher } from './events/EditorDispatcher';
import { initI18n, changeLanguage } from './i18n';
import { markdownStylesheet } from './markdownStyles';
import { getExecutionBridge, logger } from './util';
import { showSplashScreen } from './splash';

import { App } from './react/App';
import type { Managers } from './react/contexts/ManagersContext';

// The bi-directional synchronous bridge to the main execution context.
// Exposed on the window object through the preloader.
const api = getExecutionBridge();

// App mode (desktop or web).
const mode: 'web' | 'desktop' = api !== 'web' ? 'desktop' : 'web';

// Inject the markdown stylesheet into <head> so the live preview pane
// is styled the moment React mounts. The same string is inlined into
// exported HTML by HTMLExporter — single source of truth.
const markdownStyleEl = document.createElement('style');
markdownStyleEl.id = 'md-styles';
markdownStyleEl.textContent = markdownStylesheet;
document.head.appendChild(markdownStyleEl);

// Precompute bindings, warm language bundle fetch and initialize i18n.
initI18n(mode);

if (api === 'web') {
  // Web-mode language setter (replaced by the desktop variant below
  // once BridgeManager is constructed).
  window.setLanguage = (lng: string) => {
    changeLanguage(lng);
  };
}

// EditorDispatcher carries no Monaco dependency, so it can stay
// synchronous and the React tree can subscribe to its events as soon
// as it mounts (even before Monaco's chunk lands).
const dispatcher = new EditorDispatcher();

const initialManagers: Managers = {
  mode,
  editorManager: null,
  dispatcher,
  fileManager: null,
  fileTreeManager: null,
  bridgeManager: null,
  providers: {
    bridge: null,
    commands: null,
    completion: null,
    settings: null,
    exportSettings: null,
  },
};

// Setter handed to us by <App> on first render; we call it from
// boot() once Monaco's chunk has loaded and the editor manager +
// providers are constructed.
let setReactManagers: React.Dispatch<React.SetStateAction<Managers>> | null =
  null;

const reactRoot = document.getElementById('react-root');
if (!reactRoot) {
  logger?.error(
    'index',
    '#react-root not found in DOM; aborting Monaco mount.',
  );
} else {
  // Mount React immediately with an editor-less Managers object —
  // the splash overlay is still up so the user sees no blank frame.
  // The async `boot()` below loads Monaco + the manager classes as
  // a separate webpack chunk, then pushes the fully-wired managers
  // into React state via setReactManagers.
  createRoot(reactRoot).render(
    React.createElement(App, {
      initialManagers,
      onEditorReady,
      initialSidebarOpen: api !== 'web',
      registerSetManagers: (setter) => {
        setReactManagers = setter;
      },
    }),
  );

  void boot();
}

/**
 * Lazy-load every Monaco-touching module as a single async chunk and
 * construct the editor manager + providers. Webpack splits everything
 * imported here (EditorManager, the five providers, BridgeManager and
 * its FileManager/FileTreeManager/BridgeListeners, plus Monaco itself)
 * into a separate bundle that the user only downloads once, behind
 * the splash overlay.
 */
async function boot() {
  const [
    { EditorManager },
    { CommandProvider },
    { CompletionProvider },
    { MkedLinkProvider },
    { SettingsProvider },
    { ExportSettingsProvider },
    { BridgeManager },
  ] = await Promise.all([
    import('./core/EditorManager'),
    import('./core/providers/CommandProvider'),
    import('./core/providers/CompletionProvider'),
    import('./core/providers/MkedLinkProvider'),
    import('./core/providers/SettingsProvider'),
    import('./core/providers/ExportSettingsProvider'),
    import('./core/BridgeManager'),
  ]);

  const editorManager = new EditorManager({ mode, dispatcher });

  // Push the EditorManager into React state. <EditorHost>'s useEffect
  // is gated on a non-null editorManager — it only calls .create()
  // (which instantiates Monaco) once it sees the manager.
  setReactManagers?.((prev) => ({
    ...prev,
    editorManager,
    providers: editorManager.providers,
  }));

  // Stash the constructors that `onEditorReady` needs once Monaco
  // is mounted. They live in this closure and can't reach the
  // top-level `onEditorReady` otherwise.
  pendingFactories = {
    editorManager,
    CommandProvider,
    CompletionProvider,
    MkedLinkProvider,
    SettingsProvider,
    ExportSettingsProvider,
    BridgeManager,
  };
}

/* Holds factories pulled in by `boot()` so onEditorReady can use them
 * once <EditorHost> has called editorManager.create(). */
let pendingFactories: {
  editorManager: import('./core/EditorManager').EditorManager;
  CommandProvider: typeof import('./core/providers/CommandProvider').CommandProvider;
  CompletionProvider: typeof import('./core/providers/CompletionProvider').CompletionProvider;
  MkedLinkProvider: typeof import('./core/providers/MkedLinkProvider').MkedLinkProvider;
  SettingsProvider: typeof import('./core/providers/SettingsProvider').SettingsProvider;
  ExportSettingsProvider: typeof import('./core/providers/ExportSettingsProvider').ExportSettingsProvider;
  BridgeManager: typeof import('./core/BridgeManager').BridgeManager;
} | null = null;

/**
 * Runs once after <EditorHost> has called editorManager.create(). Wires
 * the providers, the IPC bridge (desktop), and the splash dismissal.
 */
function onEditorReady() {
  if (!pendingFactories) {
    logger?.error(
      'index.onEditorReady',
      'onEditorReady fired before boot() finished loading manager classes.',
    );
    return;
  }
  const {
    editorManager,
    CommandProvider,
    CompletionProvider,
    MkedLinkProvider,
    SettingsProvider,
    ExportSettingsProvider,
    BridgeManager,
  } = pendingFactories;

  const mkeditor = editorManager.getMkEditor();
  if (!mkeditor) {
    logger?.error(
      'index.onEditorReady',
      'EditorHost fired onReady but EditorManager has no Monaco instance.',
    );
    return;
  }

  editorManager.provide('settings', new SettingsProvider(mode, mkeditor));
  editorManager.provide('exportSettings', new ExportSettingsProvider(mode));
  editorManager.provide('commands', new CommandProvider(mkeditor));
  editorManager.provide('completion', new CompletionProvider(mkeditor));

  let desktopExtras: Partial<Managers> = {};
  if (api !== 'web') {
    api.receive('from:i18n:set', (lng: string) => {
      changeLanguage(lng);
    });

    const bridgeManager = new BridgeManager(api, mkeditor, dispatcher);
    bridgeManager.provide('settings', editorManager.providers.settings);
    bridgeManager.provide(
      'exportSettings',
      editorManager.providers.exportSettings,
    );
    bridgeManager.provide('commands', editorManager.providers.commands);
    editorManager.provide('bridge', bridgeManager);

    // Phase 9: wire each provider's persist callback directly into the
    // bridge instead of routing through an `editor:bridge:settings`
    // dispatcher event.
    editorManager.providers.settings?.setPersistHandler((s) =>
      bridgeManager.saveSettingsToFile(s),
    );
    editorManager.providers.exportSettings?.setPersistHandler((s) =>
      bridgeManager.saveSettingsToFile(s),
    );

    new MkedLinkProvider(mkeditor, (path) =>
      bridgeManager.fileTreeManager.hasFile(path),
    );

    editorManager.updateBridgedContent({ init: true });

    window.setLanguage = (lng: string) => {
      bridgeManager.setLanguage(lng);
    };

    desktopExtras = {
      bridgeManager,
      fileManager: bridgeManager.fileManager,
      fileTreeManager: bridgeManager.fileTreeManager,
    };
  }

  // Push a managers update unconditionally. `editorManager.providers`
  // was mutated in place by the `provide(...)` calls above, so a
  // fresh managers object is required to make React contexts
  // (SettingsContext, ExportSettingsContext) re-evaluate
  // `providers.settings`/`.exportSettings` and re-subscribe via
  // `useSyncExternalStore`.
  setReactManagers?.((prev) => ({ ...prev, ...desktopExtras }));

  showSplashScreen({ duration: 750 });
}
