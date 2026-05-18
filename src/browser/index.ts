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
import {
  getCurrentAssistantState,
  registerAssistantStateChangeListener,
} from './react/contexts/UIStateContext';

// The bi-directional synchronous bridge to the main execution context.
// Exposed on the window object through the preloader.
const api = getExecutionBridge();

// App mode (desktop or web).
const mode: 'web' | 'desktop' = api !== 'web' ? 'desktop' : 'web';

// Authoritative runtime platform. Desktop reads `process.platform` via the
// preload's `window.mked.platform`; web has no preload so we collapse it to
// `'web'`. Components that need to branch (e.g. `<TitleBar>` hiding on
// macOS) read this from Managers — no UA sniffing in React.
const mkedPlatform = window.mked?.platform;
const platform: 'web' | 'darwin' | 'win32' | 'linux' =
  mode === 'web'
    ? 'web'
    : mkedPlatform === 'darwin' || mkedPlatform === 'win32'
      ? mkedPlatform
      : 'linux';

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
  platform,
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
      initialSidebarOpen: true,
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
    { WebFileBridge },
  ] = await Promise.all([
    import('./core/EditorManager'),
    import('./core/providers/CommandProvider'),
    import('./core/providers/CompletionProvider'),
    import('./core/providers/MkedLinkProvider'),
    import('./core/providers/SettingsProvider'),
    import('./core/providers/ExportSettingsProvider'),
    import('./core/BridgeManager'),
    import('./core/WebFileBridge'),
  ]);

  const editorManager = new EditorManager({ dispatcher });

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
    WebFileBridge,
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
  WebFileBridge: typeof import('./core/WebFileBridge').WebFileBridge;
} | null = null;

/**
 * Runs once after <EditorHost> has called editorManager.create(). Wires
 * the providers, the IPC bridge (desktop), and the splash dismissal.
 */
function onEditorReady() {
  try {
    onEditorReadyInner();
  } catch (err) {
    logger?.error('index.onEditorReady', JSON.stringify(err));
  } finally {
    showSplashScreen({ duration: 750 });
  }
}

function onEditorReadyInner() {
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
    WebFileBridge,
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

  // Pick the bridge implementation that matches the runtime. Both modes
  // now construct a BridgeManager so the renderer side (FileManager,
  // FileTreeManager, BridgeListeners, the sidebar's right-click menu)
  // is mode-agnostic. The web bridge translates the same channel calls
  // into File System Access API operations.
  const bridge = api !== 'web' ? api : new WebFileBridge();
  const bridgeManager = new BridgeManager(bridge, mkeditor, dispatcher);
  bridgeManager.provide('settings', editorManager.providers.settings);
  bridgeManager.provide(
    'exportSettings',
    editorManager.providers.exportSettings,
  );
  bridgeManager.provide('commands', editorManager.providers.commands);
  editorManager.provide('bridge', bridgeManager);

  // Let FileManager honour the user's `sessionRestore` setting.
  bridgeManager.fileManager.setSessionEnabledGetter(
    () =>
      editorManager.providers.settings?.getSetting('sessionRestore') ?? true,
  );

  // AI Assistant P2: round-trip the right-sidebar view-state through
  // the existing session payload. UIStateContext keeps a live mirror
  // of `{ sidebarOpen, size }`; FileManager reads it at save time.
  // Changes inside UIStateContext fire the change listener wired
  // here, which goes through FileManager's existing 300ms-debounced
  // save pipeline so AI Assistant churn coalesces with tab churn.
  bridgeManager.fileManager.setAssistantStateGetter(getCurrentAssistantState);
  registerAssistantStateChangeListener(() =>
    bridgeManager.fileManager.notifyAssistantStateChanged(),
  );

  // Source the active file from FileManager (renderer-side, always
  // current). Reading via the main process here would lag tab switches
  // — main only learns about `from:file:opened`, not about renderer-
  // driven `activateFile` calls — so relative links in any non-most-
  // recently-opened tab would resolve against the wrong base dir.
  new MkedLinkProvider(mkeditor, () => bridgeManager.fileManager.activeFile);

  if (api !== 'web') {
    api.receive('from:i18n:set', (lng: string) => {
      changeLanguage(lng);
    });

    // Wire each provider's persist callback directly into the
    // bridge instead of routing through an `editor:bridge:settings`
    // dispatcher event. Web mode persists via localStorage inside the
    // settings providers themselves, so the handler isn't wired there.
    editorManager.providers.settings?.setPersistHandler((s) =>
      bridgeManager.saveSettingsToFile(s),
    );
    editorManager.providers.exportSettings?.setPersistHandler((s) =>
      bridgeManager.saveSettingsToFile(s),
    );

    editorManager.updateBridgedContent({ init: true });

    window.setLanguage = (lng: string) => {
      bridgeManager.setLanguage(lng);
    };
  } else {
    // Block session saves until bootstrap + restore land. Without this,
    // `seedUntitled` below fires `scheduleSessionSave`, whose 300 ms
    // debounce can race ahead of the async `bootstrap()` and overwrite
    // the previously-good session with the seeded-untitled-only state.
    // `FileManager.restoreSession` clears the suspension on entry, so
    // the very next user-driven change persists as normal.
    bridgeManager.fileManager.suspendSessionSaves();

    // Web mode: seed FileManager with an `untitled-1` tab so the
    // current Monaco buffer has a tab and shows up in the title bar.
    // If a session is later restored (via bootstrap below) and it
    // tracks an `untitled-1`, FileManager.restoreSession overwrites
    // the seeded content with the session's saved content.
    bridgeManager.fileManager.seedUntitled(mkeditor.getValue());

    // Boot the web bridge: silent workspace restore + session load +
    // legacy `mkeditor-content` migration + `beforeunload` flush. The
    // bootstrap fires `from:session:restore` exactly once (with a
    // null session payload if nothing's persisted yet), mirroring
    // main's behaviour on desktop.
    void (bridge as InstanceType<typeof WebFileBridge>).bootstrap();
  }

  setReactManagers?.((prev) => ({
    ...prev,
    bridgeManager,
    fileManager: bridgeManager.fileManager,
    fileTreeManager: bridgeManager.fileTreeManager,
  }));
}
