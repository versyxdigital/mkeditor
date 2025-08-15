import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { ContextBridgeAPI, ContextBridgedFile } from '../../interfaces/Bridge';
import { BridgeProviders, ValidModal } from '../../interfaces/Providers';
import { EditorSettings } from '../../interfaces/Editor';
import { EditorDispatcher } from '../../events/EditorDispatcher';
import { Notify } from '../Notify';
import { FileManager } from './FileManager';
import { FileTree } from './FileTreeManager';
import { BridgeSettings } from './BridgeSettings';

/**
 * Register bridge channel listeners.
 */
export function registerBridgeListeners(
  bridge: ContextBridgeAPI,
  model: editor.IStandaloneCodeEditor,
  dispatcher: EditorDispatcher,
  providers: BridgeProviders,
  files: FileManager,
  tree: FileTree,
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
    settings.loadSettingsFromStorageChannel(s);
    providers.settings?.setSettings(s);
    providers.settings?.registerDOMListeners();
  });

  // Enable new files from outside of the renderer execution context.
  bridge.receive('from:file:new', (channel: string) => {
    bridge.send('to:title:set', '');
    bridge.send(channel, {
      content: model.getValue(),
      file: files.activeFile,
    });
  });

  // Enable saving files from outside of the renderer execution context.
  bridge.receive('from:file:save', (channel: string) => {
    if (files.activeFile && !files.activeFile.startsWith('untitled')) {
      bridge.send(channel, {
        content: model.getValue(),
        file: files.activeFile,
      });

      files.originals.set(files.activeFile, model.getValue());
      dispatcher.setTrackedContent({
        content: model.getValue(),
      });
    } else {
      bridge.send('to:file:saveas', model.getValue());
    }
  });

  bridge.receive('from:file:saveas', (channel: string) => {
    bridge.send(channel, model.getValue());
  });

  // Handle opening folders and constructing file tree
  bridge.receive('from:folder:open', (channel: string) => {
    tree.openingFolder = true;
    bridge.send(channel, true);
  });

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

  bridge.receive(
    'from:file:opened',
    ({ content, filename, file }: ContextBridgedFile) => {
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
    model.focus();
    model.trigger(command, 'editor.action.quickCommand', {});
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
      Notify.send(event.status, event.message);
    },
  );
}
