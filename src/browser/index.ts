import './mappings/icons';
import { Editor } from './lib/Editor';
import { EditorDispatcher } from './events/EditorDispatcher';
import { Completion } from './lib/Completion';
import { Commands } from './lib/Commands';
import { Settings } from './lib/Settings';
import { Bridge } from './lib/Bridge';
import {
  dom,
  showSplashScreen,
  setupTooltips,
  createDraggableSplitPanels,
  createSidebarToggle,
} from './dom';
import { getExecutionBridge } from './util';

// The bi-directional synchronous bridge to the main execution context.
// Exposed on the window object through the preloader.
const api = getExecutionBridge();

// App mode (desktop or web).
const mode = api !== 'web' ? 'desktop' : 'web';

// If the app is in web mode hide the filetree sidebar.
if (mode === 'web') {
  document.addEventListener('DOMContentLoaded', () => {
    dom.sidebar.style.display = 'none';
  });
}

// Create new custom event dispatcher.
const dispatcher = new EditorDispatcher();

// Create a new editor.
const mkeditor = new Editor(mode, dispatcher);
mkeditor.create({ watch: true });

// Get the editor model.
const model = mkeditor.getModel();

if (model) {
  // Register new command handler for the model to provide and handle editor
  // commands and actions (e.g. bold, alertblock etc.)
  mkeditor.provide('commands', new Commands(mode, model, dispatcher));

  // Register a new settings handler for the model to provide editor settings
  // and to persist settings either to localStorage or file depending on context.
  mkeditor.provide('settings', new Settings(mode, model, dispatcher));

  // Register a new completion provider for the editor auto-completion
  mkeditor.provide('completion', new Completion(model, dispatcher));

  // If running within electron app, register IPC handler for communication between
  // main and renderer execution contexts.
  if (api !== 'web') {
    // Create a new bridge communication handler.
    const bridge = new Bridge(api, model, dispatcher);

    // Attach providers.
    bridge.provide('settings', mkeditor.providers.settings);
    bridge.provide('commands', mkeditor.providers.commands);
    mkeditor.provide('bridge', bridge);

    // Initialize content tracker for the execution bridge.
    mkeditor.updateBridgedContent({ initialize: true });
  }

  // Setup application tooltips.
  setupTooltips();

  // Implement draggable split.
  createDraggableSplitPanels(model);

  // Implement sidebar toggle.
  createSidebarToggle(model);

  // Display splash screen
  showSplashScreen({
    duration: 750,
  });
}
