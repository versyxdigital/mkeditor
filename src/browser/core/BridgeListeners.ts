import { editor } from 'monaco-editor';
import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type { File, FileProperties, RenamedPath } from '../interfaces/File';
import type { BridgeProviders } from '../interfaces/Providers';
import type { SettingsFile } from '../interfaces/Editor';
import type { EditorDispatcher } from '../events/EditorDispatcher';
import type { FileManager } from './FileManager';
import type { FileTreeManager } from './FileTreeManager';
import {
  openModalExternal,
  type ModalKey,
} from '../react/contexts/ModalsContext';
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

  // Enable new files from outside of the renderer execution context.
  bridge.receive('from:file:new', (channel: string) => {
    bridge.send('to:title:set', '');
    bridge.send(channel, {
      content: mkeditor.getValue(),
      file: files.activeFile,
    });
  });

  // Enable saving files from outside of the renderer execution context.
  bridge.receive('from:file:save', (channel: string) => {
    if (files.activeFile && !files.activeFile.startsWith('untitled')) {
      bridge.send(channel, {
        content: mkeditor.getValue(),
        file: files.activeFile,
      });

      files.originals.set(files.activeFile, mkeditor.getValue());
      dispatcher.setTrackedContent({
        content: mkeditor.getValue(),
      });
    } else {
      bridge.send('to:file:saveas', mkeditor.getValue());
    }
  });

  // Handle file save-as events
  bridge.receive('from:file:saveas', (channel: string) => {
    bridge.send(channel, mkeditor.getValue());
  });

  // Handle opening folders and constructing file tree
  bridge.receive('from:folder:open', (channel: string) => {
    tree.openingFolder = true;
    bridge.send(channel, true);
  });

  // Handle post-folder open events
  bridge.receive('from:folder:opened', ({ tree: t, path }) => {
    if (
      tree.openingFolder ||
      !tree.treeRoot ||
      !path.startsWith(tree.treeRoot)
    ) {
      tree.treeRoot = path;
      tree.openingFolder = false;
    }
    tree.buildFileTree(t, path);
  });

  // Enable opening files from outside of the renderer execution context.
  bridge.receive('from:file:open', (channel: string) => {
    files.openingFile = true;
    bridge.send(channel, true);
  });

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
  bridge.receive('from:command:palette', (command: string) => {
    mkeditor.focus();
    mkeditor.trigger(command, 'editor.action.quickCommand', {});
  });

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

  // Phase 1 verification stub — confirms the new channel reaches the
  // renderer. The full `FileManager.restoreSession` handler replaces
  // this in Phase 2.
  bridge.receive('from:session:restore', (payload: unknown) => {
    console.info('[session] received from:session:restore', payload);
  });
}
