import { editor } from 'monaco-editor';
import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type { File, FileProperties, RenamedPath } from '../interfaces/File';
import type { BridgeProviders } from '../interfaces/Providers';
import type { SettingsFile } from '../interfaces/Editor';
import type { SessionRestoreEnvelope } from '../interfaces/Session';
import type { EditorDispatcher } from '../events/EditorDispatcher';
import type { BridgeManager } from './BridgeManager';
import type { FileManager } from './FileManager';
import type { FileTreeManager } from './FileTreeManager';
import {
  openModalExternal,
  type ModalKey,
} from '../react/contexts/ModalsContext';
import { applyRestoredAssistantState } from '../react/contexts/UIStateContext';
import { sonnerToast } from '../notify';
import { showPropertiesExternal } from '../react/contexts/PropertiesContext';
import { basename } from '../util';
import { t, whenLanguageReady } from '../i18n';

/**
 * Register bridge channel listeners.
 */
export function registerBridgeListeners(
  bridge: ContextBridgeAPI,
  mkeditor: editor.IStandaloneCodeEditor,
  dispatcher: EditorDispatcher,
  providers: BridgeProviders,
  files: FileManager,
  tree: FileTreeManager,
  manager: BridgeManager,
) {
  const loadSettingsFromBridgeListener = (settings: SettingsFile) => {
    mkeditor.updateOptions({
      autoIndent: settings.autoindent ? 'advanced' : 'none',
    });

    mkeditor.updateOptions({
      wordWrap: settings.wordwrap ? 'on' : 'off',
    });

    mkeditor.updateOptions({
      renderWhitespace: settings.whitespace ? 'all' : 'none',
    });

    mkeditor.updateOptions({
      minimap: { enabled: settings.minimap },
    });
  };

  // Set the theme according to the user's system theme. React
  // subscribes to SettingsProvider's emitter so the navbar
  // darkmode toggle reflects the change.
  bridge.receive('from:theme:set', (shouldUseDarkMode: boolean) => {
    if (shouldUseDarkMode) {
      providers.settings?.updateSetting('darkmode', shouldUseDarkMode);
    }
  });

  // Set settings from stored settings file (%HOME%/.mkeditor/settings.json).
  // The providers' setSettings emits to SettingsContext / ExportSettingsContext
  // subscribers and the React modals re-render to reflect the loaded values.
  bridge.receive('from:settings:set', (s: SettingsFile) => {
    loadSettingsFromBridgeListener(s);
    providers.settings?.setSettings(s);
    providers.exportSettings?.setSettings(s.exportSettings);
  });

  // File / folder menu actions delegate to BridgeManager helpers so the
  // in-window menu (P2) can reach the same effects without re-routing
  // through `bridge.receive`.
  bridge.receive('from:file:new', () => manager.menuFileNew());
  bridge.receive('from:file:save', () => manager.menuFileSave());
  bridge.receive('from:file:saveas', () => manager.menuFileSaveAs());
  bridge.receive('from:folder:open', () => manager.menuFolderOpen());

  // Handle post-folder open events
  bridge.receive('from:folder:opened', ({ tree: t, path }) => {
    const rootChanged = !tree.treeRoot || !path.startsWith(tree.treeRoot);
    if (tree.openingFolder || rootChanged) {
      tree.treeRoot = path;
      tree.openingFolder = false;
    }
    tree.buildFileTree(t, path);
    // Persist the new workspace root if it changed. Sub-directory
    // expands (lazy-load) reuse the existing root, so they don't need
    // their own save trigger.
    if (rootChanged) files.scheduleSessionSave();
  });

  // Enable opening files from outside of the renderer execution context.
  bridge.receive('from:file:open', () => manager.menuFileOpen());

  // Handle post-file open events. We ignore the `filename` field in
  // the payload and derive the tab label from the path's basename
  // (POSIX `/` or Win `\`). Main's setActiveFile used to split only
  // on `\`, so on Linux/macOS the renderer was receiving the full
  // path as `filename` and rendering it in the tab. The Navbar reads
  // the active file's PATH for the title bar — the tab itself only
  // shows the filename.
  bridge.receive('from:file:opened', ({ content, file }: File) => {
    const path = file || `untitled-${files.untitledCounter++}`;
    const name = file
      ? basename(file)
      : `Untitled ${files.untitledCounter - 1}`;

    if (files.models.has(path)) {
      // Already open — just activate.
      tree.addFileToTree(path);
      files.activateFile(path, name);
      files.openingFile = false;
      return;
    }

    // If the active tab is an untitled scratch buffer and we have a real
    // file path, replace the untitled in place (preserves the typed
    // content's model identity and tab position).
    if (file && files.replaceUntitled(path, name, content)) {
      tree.addFileToTree(path);
      files.activateFile(path, name);
      files.openingFile = false;
      return;
    }

    // Fallback: create a fresh model + tab.
    const mdl = editor.createModel(content, 'markdown');
    files.models.set(path, mdl);
    files.originals.set(path, content);
    files.trackTab(path, mdl);
    files.addTab(name, path);

    tree.addFileToTree(path);
    files.activateFile(path, name);
    files.openingFile = false;
  });

  // Enable renaming of files and folders. Same basename derivation as
  // from:file:opened so the tab label stays consistent across OSes.
  bridge.receive('from:path:renamed', ({ oldPath, newPath }: RenamedPath) => {
    files.renameTab(oldPath, newPath, basename(newPath));
  });

  // Enable access to the monaco editor command palette.
  bridge.receive('from:command:palette', () => manager.menuCommandPalette());

  // Opens a React shadcn-Dialog modal triggered from the main process
  // (e.g., a tray/menu item).
  bridge.receive('from:modal:open', (modal: ModalKey) => {
    openModalExternal(modal);
  });

  // Enable notifications from the main context. Translation is deferred
  // behind `whenLanguageReady()` so a "settings saved" toast that
  // arrives during a locale switch is rendered in the *new* language —
  // the locale-change IPC and the settings-save IPC race back from the
  // main process, and without this guard the toast would resolve
  // against the previous language's bundle.
  bridge.receive('from:notification:display', (event: any) => {
    const { status } = event || {};
    const key: string | undefined = event?.key;
    const values: Record<string, unknown> | undefined = event?.values;
    const message: string | undefined = event?.message;

    const show = () => {
      const text = key
        ? t(key, values)
        : typeof message === 'string'
          ? message
          : '';
      if (text) sonnerToast(status || 'info', text);
    };

    if (key) {
      void whenLanguageReady().then(show);
    } else {
      show();
    }
  });

  // Trigger the file properties window from the context menu.
  bridge.receive('from:path:properties', (info: FileProperties) => {
    showPropertiesExternal(info);
  });

  // Replay the persisted session into FileManager. The envelope was
  // pre-filtered by main (missing real-file paths excluded, contents
  // pre-loaded), so the tab replay is purely in-renderer + synchronous.
  // The workspace folder restore is the one async step: we ask main
  // to re-walk the persisted root via `to:file:openpath`, which fires
  // the normal `from:folder:opened` flow.
  bridge.receive('from:session:restore', (envelope: SessionRestoreEnvelope) => {
    if (envelope?.missing && envelope.missing.length > 0) {
      sonnerToast(
        'warning',
        t('notifications:session_file_missing', {
          files: envelope.missing.join(', '),
        }),
      );
    }
    if (envelope) files.restoreSession(envelope);
    // If nothing landed (no session and no CLI-arg file is queued to
    // open), seed an `untitled-1` from the welcome markdown that
    // Monaco was created with. Mirrors the web boot pattern and
    // avoids "editor has content, but no tab" first-launch UX.
    // If a CLI file *is* about to open, the `from:file:opened`
    // handler's `replaceUntitled` swap absorbs this seed in place.
    if (files.tabs.size === 0) {
      files.seedUntitled(mkeditor.getValue());
    }
    const root = envelope?.session?.workspaceRoot;
    if (root) {
      // Mark openingFolder so `from:folder:opened` treats this as a
      // root populate rather than a lazy-load.
      tree.openingFolder = true;
      bridge.send('to:file:openpath', { path: root });
    }
    // AI Assistant P2: forward the right-sidebar view-state (open + size)
    // into UIStateContext via the module-level seam. v1 payloads omit
    // the block; UIStateContext keeps its initial defaults in that case.
    const assistant = envelope?.session?.assistant;
    if (assistant) {
      applyRestoredAssistantState(assistant);
    }
  });

  // Final flush ahead of quit. Main's `before-quit` hook sends this
  // and waits up to ~250 ms for the `to:session:save` ack — so the
  // serialisation runs synchronously here and we ship immediately.
  bridge.receive('from:session:flush-request', () => {
    bridge.send('to:session:save', files.serializeSession());
  });

  // BrowserWindow maximize/unmaximize state — `<TitleBar>`'s maximize
  // icon reads this through WindowContext via BridgeManager's snapshot.
  bridge.receive(
    'from:window:state',
    (state: { isMaximized: boolean } | undefined) => {
      manager.setWindowState({ isMaximized: !!state?.isMaximized });
    },
  );
}
