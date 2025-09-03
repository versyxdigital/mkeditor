import './icons';
import { EditorDispatcher } from './events/EditorDispatcher';
import { EditorManager } from './core/EditorManager';
import { CompletionProvider } from './core/providers/CompletionProvider';
import { CommandProvider } from './core/providers/CommandProvider';
import { MkedLinkProvider } from './core/providers/MkedLinkProvider';
import { SettingsProvider } from './core/providers/SettingsProvider';
import { ExportSettingsProvider } from './core/providers/ExportSettingsProvider';
import { BridgeManager } from './core/BridgeManager';
import { initI18n, changeLanguage } from './i18n';
import { getExecutionBridge } from './util';
import {
  dom,
  showSplashScreen,
  createDraggableSplitPanels,
  createSidebarToggle,
  resetEditorPreviewSplit,
} from './dom';

// The bi-directional synchronous bridge to the main execution context.
// Exposed on the window object through the preloader.
const api = getExecutionBridge();

// App mode (desktop or web).
const mode = api !== 'web' ? 'desktop' : 'web';

// Precompute bindings, warm language bundle fetch and initialize i18n.
initI18n(mode);

if (api === 'web') {
  // If the app is in web mode hide the filetree sidebar,
  // show the markdown content delete button.
  dom.sidebar.classList.add('d-none');
  dom.buttons.delete.classList.remove('d-none');

  // Expose a language setter for web mode.
  window.setLanguage = (lng: string) => {
    changeLanguage(lng);
  };
}

// Create new editor event dispatcher.
const dispatcher = new EditorDispatcher();

// Create a new editor manager.
const editorManager = new EditorManager({
  mode,
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
  const commandProvider = new CommandProvider(mkeditor);
  editorManager.provide('commands', commandProvider);

  // Register a new completion provider for the editor auto-completion
  editorManager.provide('completion', new CompletionProvider(mkeditor));

  // If running within electron app, register IPC handler for communication
  // between main and renderer execution contexts.
  if (api !== 'web') {
    // Register localization handler immediately.
    api.receive('from:i18n:set', (lng: string) => {
      changeLanguage(lng);
    });

    // Create a new bridge communication handler.
    const bridgeManager = new BridgeManager(api, mkeditor, dispatcher);

    // Register desktop-only commands
    commandProvider.registerDesktopOnly(api);

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
    window.setLanguage = (lng: string) => {
      bridgeManager.setLanguage(lng);
    };
  }

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
