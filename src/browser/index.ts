import './icons';
import { EditorDispatcher } from './events/EditorDispatcher';
import { EditorManager } from './core/EditorManager';
import { CompletionProvider } from './core/providers/CompletionProvider';
import { CommandProvider } from './core/providers/CommandProvider';
import { MkedLinkProvider } from './core/providers/MkedLinkProvider';
import { SettingsProvider } from './core/providers/SettingsProvider';
import { ExportSettingsProvider } from './core/providers/ExportSettingsProvider';
import { BridgeManager } from './core/BridgeManager';
import {
  dom,
  showSplashScreen,
  setupTooltips,
  createDraggableSplitPanels,
  createSidebarToggle,
  resetEditorPreviewSplit,
} from './dom';
import { getExecutionBridge } from './util';
import { I18n, initI18n, changeLanguage, normalizeLanguage } from './i18n';

// The bi-directional synchronous bridge to the main execution context.
// Exposed on the window object through the preloader.
const api = getExecutionBridge();

// App mode (desktop or web).
const mode = api !== 'web' ? 'desktop' : 'web';

// Initialize i18n based on app or browser locale
(() => {
  const initial =
    mode === 'desktop'
      ? (window as any).mked?.getAppLocale?.()
      : navigator.language;
  console.log({ initial });
  initI18n('en');

  if (api !== 'web') {
    api.receive('from:i18n:set', (lng: string) => {
      changeLanguage(lng);
    });
  }
})();

// If the app is in web mode hide the filetree sidebar.
if (mode === 'web') {
  document.addEventListener('DOMContentLoaded', () => {
    dom.sidebar.classList.add('d-none');
  });
}

// Create new editor event dispatcher.
const dispatcher = new EditorDispatcher();

// Create a new editor manager.
const editorManager = new EditorManager({
  dispatcher,
  init: true,
  watch: true,
});

// Get the editor instance.
const mkeditor = editorManager.getMkEditor();

if (mkeditor) {
  // Register new settings handlers for the editor to provide settings and to
  // persist settings either to localStorage or file depending on context.
  editorManager.provide(
    'settings',
    new SettingsProvider(mode, mkeditor, dispatcher),
  );
  editorManager.provide(
    'exportSettings',
    new ExportSettingsProvider(mode, dispatcher),
  );

  // Register new command handler for the editor to provide and handle editor
  // commands and actions (e.g. bold, alertblock etc.)
  editorManager.provide('commands', new CommandProvider(mkeditor));

  // Register a new completion provider for the editor auto-completion
  editorManager.provide('completion', new CompletionProvider(mkeditor));

  // If running within electron app, register IPC handler for communication
  // between main and renderer execution contexts.
  if (api !== 'web') {
    // Create a new bridge communication handler.
    const bridgeManager = new BridgeManager(api, mkeditor, dispatcher);

    // Attach providers.
    bridgeManager.provide('settings', editorManager.providers.settings);
    bridgeManager.provide(
      'exportSettings',
      editorManager.providers.exportSettings,
    );
    bridgeManager.provide('commands', editorManager.providers.commands);
    editorManager.provide('bridge', bridgeManager);

    // Register link provider for mked:// navigation for linked documents.
    new MkedLinkProvider(mkeditor);

    // Initialize content tracker for the execution bridge.
    editorManager.updateBridgedContent({ init: true });

    // Expose a language setter for desktop via the bridge
    (window as any).setLanguage = (lng: string) => {
      bridgeManager.setLanguage(lng);
    };
  }

  // Expose a language setter for web
  if (api === 'web') {
    (window as any).setLanguage = (lng: string) => {
      changeLanguage(lng);
    };
  }

  // Setup application tooltips.
  setupTooltips();

  // Implement draggable split.
  createDraggableSplitPanels(mkeditor);
  dom.buttons.resetSplit?.addEventListener('click', () => {
    resetEditorPreviewSplit(mkeditor);
  });

  // Implement sidebar toggle.
  createSidebarToggle(mkeditor);

  // Display splash screen
  showSplashScreen({
    duration: 750,
  });
}
