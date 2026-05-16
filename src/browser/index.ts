import './icons';
import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { EditorDispatcher } from './events/EditorDispatcher';
import { EditorManager } from './core/EditorManager';
import { CompletionProvider } from './core/providers/CompletionProvider';
import { CommandProvider } from './core/providers/CommandProvider';
import { MkedLinkProvider } from './core/providers/MkedLinkProvider';
import { SettingsProvider } from './core/providers/SettingsProvider';
import { ExportSettingsProvider } from './core/providers/ExportSettingsProvider';
import { BridgeManager } from './core/BridgeManager';
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
  // Expose a language setter for web mode.
  // (Phase 6: the legacy `dom.buttons.delete.classList.remove('d-none')`
  // is gone — <EditorToolbar> renders the delete button conditionally
  // on `mode === 'web'`.)
  window.setLanguage = (lng: string) => {
    changeLanguage(lng);
  };
}

// Construct the dispatcher and editor manager up-front; Monaco itself is
// created later, by <EditorHost> inside the React tree.
const dispatcher = new EditorDispatcher();
const editorManager = new EditorManager({ mode, dispatcher });

const initialManagers: Managers = {
  mode,
  editorManager,
  dispatcher,
  fileManager: null,
  fileTreeManager: null,
  bridgeManager: null,
  providers: editorManager.providers,
};

// Setter handed to us by <App> on first render; we call it from
// onEditorReady once BridgeManager (and therefore FileManager +
// FileTreeManager) have been constructed, so React contexts see them.
let setReactManagers: React.Dispatch<React.SetStateAction<Managers>> | null =
  null;

/**
 * Runs once after <EditorHost> has called editorManager.create(). Wires
 * the providers, the IPC bridge (desktop), and the legacy split/sidebar/
 * splash chrome that depend on a live Monaco instance.
 */
function onEditorReady() {
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

  // Push a managers update unconditionally. `editorManager.providers` was
  // mutated in place by the `provide(...)` calls above, so a fresh
  // managers object is required to make React contexts (SettingsContext,
  // ExportSettingsContext) re-evaluate `providers.settings` /
  // `.exportSettings` and re-subscribe via `useSyncExternalStore`.
  // Without this, web mode never sees the providers attach and every
  // setting/modal control becomes a no-op.
  setReactManagers?.((prev) => ({ ...prev, ...desktopExtras }));

  // Splits, sidebar visibility, and split-reset are now owned by the
  // React tree (<Shell> + <Workspace> in App.tsx). The legacy
  // #sidebar-toggle and #split-reset buttons are bridged via useEffect
  // listeners inside those components.

  showSplashScreen({ duration: 750 });
}

// Sidebar starts open in desktop mode (legacy behaviour) and collapsed
// in web mode (legacy had `dom.sidebar.classList.add('d-none')` on boot).
const initialSidebarOpen = api !== 'web';

const reactRoot = document.getElementById('react-root');
if (reactRoot) {
  createRoot(reactRoot).render(
    React.createElement(App, {
      initialManagers,
      onEditorReady,
      initialSidebarOpen,
      registerSetManagers: (setter) => {
        setReactManagers = setter;
      },
    }),
  );
} else {
  logger?.error(
    'index',
    '#react-root not found in DOM; aborting Monaco mount.',
  );
}
