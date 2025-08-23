import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import type {
  ContextBridgeAPI,
  BridgedFile,
  FileProperties,
} from '../interfaces/Bridge';
import type { BridgeProviders, ValidModal } from '../interfaces/Providers';
import type { EditorSettings } from '../interfaces/Editor';
import type { EditorDispatcher } from '../events/EditorDispatcher';
import type { FileManager } from './FileManager';
import type { FileTreeManager } from './FileTreeManager';
import type { BridgeSettings } from './BridgeSettings';
import { showFilePropertiesWindow } from '../dom';
import { notify } from '../util';

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
  settings: BridgeSettings,
) {
  // Set the theme according to the user's system theme
  bridge.receive('from:theme:set', (shouldUseDarkMode: boolean) => {
    if (shouldUseDarkMode) {
      providers.settings?.setSetting('darkmode', shouldUseDarkMode);
      providers.settings?.setTheme();
      providers.settings?.setUIState();
    }
  });

  // Set settings from stored settings file (%HOME%/.mkeditor/settings.json)
  bridge.receive('from:settings:set', (s: EditorSettings) => {
    settings.loadSettingsFromBridgeListener(s);
    providers.settings?.setSettings(s);
    providers.settings?.registerDOMListeners();
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

  // Handle post-file open events
  bridge.receive(
    'from:file:opened',
    ({ content, filename, file }: BridgedFile) => {
      const path = file || `untitled-${files.untitledCounter++}`;
      const name = filename || `Untitled ${files.untitledCounter - 1}`;
      let mdl = files.models.get(path);

      if (
        !mdl &&
        !files.openingFile &&
        files.activeFile &&
        files.activeFile.startsWith('untitled') &&
        file
      ) {
        mdl = files.models.get(files.activeFile);
        const tab = files.tabs.get(files.activeFile);
        if (mdl && tab) {
          files.models.delete(files.activeFile);
          files.tabs.delete(files.activeFile);
          files.originals.delete(files.activeFile);

          tab.textContent = name;
          const newTab = tab.cloneNode(true) as HTMLAnchorElement;
          newTab.textContent = name;
          newTab.addEventListener('click', (e) => {
            e.preventDefault();
            files.activateFile(path);
          });
          tab.replaceWith(newTab);

          files.models.set(path, mdl);
          files.tabs.set(path, newTab);
          files.originals.set(path, content);

          mdl.setValue(content);

          const closeBtn =
            newTab.nextElementSibling as HTMLButtonElement | null;
          if (closeBtn) {
            const newBtn = closeBtn.cloneNode(true) as HTMLButtonElement;
            newBtn.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              await files.closeTab(path);
            });
            closeBtn.replaceWith(newBtn);
          }
        }
      }

      // Fallback
      if (!mdl) {
        mdl = editor.createModel(content, 'markdown');
        files.models.set(path, mdl);
        files.originals.set(path, content);
        files.addTab(name, path);
      }

      tree.addFileToTree(path);
      files.activateFile(path, name);
      files.openingFile = false;
    },
  );

  // Enable access to the monaco editor command palette.
  bridge.receive('from:command:palette', (command: string) => {
    mkeditor.focus();
    mkeditor.trigger(command, 'editor.action.quickCommand', {});
  });

  // Enable access to the monaco editor shortcuts modal.
  bridge.receive('from:modal:open', (modal: ValidModal) => {
    const handler = providers.commands?.getModal(modal);
    handler?.toggle();
  });

  // Enable notifications from the main context.
  bridge.receive(
    'from:notification:display',
    (event: { status: string; message: string }) => {
      notify.send(event.status, event.message);
    },
  );

  // Trigger the file properties window from the context menu.
  bridge.receive('from:path:properties', (info: FileProperties) => {
    showFilePropertiesWindow(info);
  });
}
