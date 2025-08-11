import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { ContextBridgeAPI, ContextBridgedFile } from '../interfaces/Bridge';
import { BridgeProviders, ValidModal } from '../interfaces/Providers';
import { EditorSettings } from '../interfaces/Editor';
import { EditorDispatcher } from '../events/EditorDispatcher';
import { Notify } from './Notify';
import { dom } from '../dom';

export class Bridge {
  /** Execution context bridge */
  private bridge: ContextBridgeAPI;

  /** Editor model instance */
  private model: editor.IStandaloneCodeEditor;

  /** Editor event dispatcher */
  private dispatcher: EditorDispatcher;

  /** The current active file */
  private activeFile: string | null = null;

  /** Flag to determine whether the content has changed */
  private contentHasChanged: boolean = false;

  /** Map of open file models */
  private models: Map<string, editor.ITextModel> = new Map();

  /** Map of original contents */
  private originals: Map<string, string> = new Map();

  /** Map of tab elements */
  private tabs: Map<string, HTMLAnchorElement> = new Map();

  /** counter for untitled files */
  private untitledCounter = 1;

  /** Flag to indicate that a file is being opened */
  private openingFile = false;

  /** Providers to be accessed through bridge */
  public providers: BridgeProviders = {
    settings: null,
    commands: null,
    completion: null,
  };

  /**
   * Create a new mkeditor bridge.
   *
   * Responsible for creating a bridge and handling events between
   * execution contexts.
   *
   * @param bridge - the execution bridge
   * @param model  - the editor model instance
   * @param dispatcher - the editor event dispatcher
   */
  public constructor(
    bridge: ContextBridgeAPI,
    model: editor.IStandaloneCodeEditor,
    dispatcher: EditorDispatcher,
  ) {
    this.bridge = bridge;
    this.model = model;
    this.dispatcher = dispatcher;

    this.register();

    this.dispatcher.addEventListener('editor:bridge:settings', (event) => {
      this.saveSettingsToFile(event.message);
    });
  }

  /**
   * Provide access to a provider.
   *
   * @param provider - the provider to access
   * @param instance - the associated provider instance
   */
  public provide<T>(provider: string, instance: T) {
    this.providers[provider] = instance;
  }

  /**
   * Register bridge events.
   */
  public register() {
    // Set the theme according to the user's system theme
    this.bridge.receive('from:theme:set', (shouldUseDarkMode: boolean) => {
      if (shouldUseDarkMode) {
        this.providers.settings?.setSetting('darkmode', shouldUseDarkMode);
        this.providers.settings?.setTheme();
        this.providers.settings?.setUIState();
      }
    });

    // Set settings from stored settings file (%HOME%/.mkeditor/settings.json)
    this.bridge.receive('from:settings:set', (settings: EditorSettings) => {
      this.loadSettingsFromStorageChannel(settings);
      this.providers.settings?.setSettings(settings);
      this.providers.settings?.registerDOMListeners();
    });

    // Enable new files from outside of the renderer execution context.
    // Provides access to browser window data and emits it to the ipc channel.
    this.bridge.receive('from:file:new', (channel: string) => {
      this.bridge.send('to:title:set', '');
      this.bridge.send(channel, {
        content: this.model.getValue(),
        file: this.activeFile,
      });
    });

    // Enable saving files from outside of the renderer execution context.
    // Provides access to browser window data and emits it to the ipc channel.
    this.bridge.receive('from:file:save', (channel: string) => {
      this.bridge.send(channel, {
        content: this.model.getValue(),
        file: this.activeFile,
      });
      if (this.activeFile) {
        this.originals.set(this.activeFile, this.model.getValue());
        this.dispatcher.setTrackedContent({
          content: this.model.getValue(),
        });
      }
    });

    this.bridge.receive('from:file:saveas', (channel: string) => {
      this.bridge.send(channel, this.model.getValue());
    });

    // Handle opening folders and constructing file tree
    this.bridge.receive('from:folder:open', (channel: string) => {
      this.bridge.send(channel, true);
    });

    this.bridge.receive('from:folder:opened', ({ tree }) => {
      this.buildFileTree(tree);
    });

    // Enable opening files from outside of the renderer execution context.
    // If there are changes to the current file, user will be prompted and
    // the open event will be handled through this bridge channel's handler.
    this.bridge.receive('from:file:open', (channel: string) => {
      this.openingFile = true;
      if (this.contentHasChanged) {
        this.bridge.send('to:file:save', {
          content: this.model.getValue(),
          file: this.activeFile,
          prompt: true,
          fromOpen: true,
        });
      } else {
        this.bridge.send(channel, true);
      }
    });

    this.bridge.receive(
      'from:file:opened',
      ({ content, filename, file }: ContextBridgedFile) => {
        const path = file || `untitled-${this.untitledCounter++}`;
        const name = filename || `Untitled ${this.untitledCounter - 1}`;
        let mdl = this.models.get(path);

        if (
          !mdl &&
          !this.openingFile &&
          this.activeFile &&
          this.activeFile.startsWith('untitled') &&
          file
        ) {
          mdl = this.models.get(this.activeFile);
          const tab = this.tabs.get(this.activeFile);
          if (mdl && tab) {
            this.models.delete(this.activeFile);
            this.tabs.delete(this.activeFile);
            this.originals.delete(this.activeFile);

            tab.textContent = name;
            this.models.set(path, mdl);
            this.tabs.set(path, tab);
            this.originals.set(path, content);

            mdl.setValue(content);

            const closeBtn = tab.nextElementSibling as HTMLButtonElement | null;
            if (closeBtn) {
              const newBtn = closeBtn.cloneNode(true) as HTMLButtonElement;
              newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeTab(path);
              });
              closeBtn.replaceWith(newBtn);
            }
          }
        }

        // Fallback
        if (!mdl) {
          mdl = editor.createModel(content, 'markdown');
          this.models.set(path, mdl);
          this.originals.set(path, content);
          this.addTab(name, path);
        }

        this.activateFile(path, name);
        this.openingFile = false;
      },
    );

    // Enable access to the monaco editor command palette.
    this.bridge.receive('from:command:palette', (command: string) => {
      this.model.focus();
      this.model.trigger(command, 'editor.action.quickCommand', {});
    });

    // Enable access to the monaco editor shortcuts modal.
    this.bridge.receive('from:modal:open', (modal: ValidModal) => {
      const handler = this.providers.commands?.getModal(modal);
      handler?.toggle();
    });

    // Enable notifications from the main context.
    this.bridge.receive(
      'from:notification:display',
      (event: { status: string; message: string }) => {
        Notify.send(event.status, event.message);
      },
    );
  }

  /**
   * Send a save settings request across the bridge.
   *
   * @param settings - the settings to save
   */
  public saveSettingsToFile(settings: EditorSettings) {
    this.bridge.send('to:settings:save', { settings });
  }

  /**
   * Send a save contents request across the bridge.
   */
  public saveContentToFile() {
    if (this.activeFile && !this.activeFile.startsWith('untitled')) {
      this.bridge.send('to:file:save', {
        content: this.model.getValue(),
        file: this.activeFile,
      });
      this.originals.set(this.activeFile, this.model.getValue());
      this.dispatcher.setTrackedContent({
        content: this.model.getValue(),
      });
    } else {
      this.bridge.send('to:file:saveas', this.model.getValue());
    }
  }

  /**
   * Send an export preview request across the bridge.
   *
   * @param content - the content to export
   */
  public exportPreviewToFile(content: string) {
    this.bridge.send('to:html:export', { content });
  }

  private addTab(name: string, path: string) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = name;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      this.activateFile(path);
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.classList.add('tab-close');
    close.innerHTML = '&times;';
    close.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.closeTab(path);
    });

    li.appendChild(a);
    li.appendChild(close);
    dom.tabs?.appendChild(li);
    this.tabs.set(path, a);
  }

  private closeTab(path: string) {
    const mdl = this.models.get(path);
    if (!mdl) return;

    const original = this.originals.get(path) ?? '';
    const current = mdl.getValue();

    if (original !== current) {
      const save = window.confirm(
        'You have unsaved changes. Save before closing?',
      );
      if (save) {
        if (path.startsWith('untitled')) {
          this.bridge.send('to:file:saveas', current);
        } else {
          this.bridge.send('to:file:save', { content: current, file: path });
        }
      }
    }

    mdl.dispose();
    this.models.delete(path);
    this.originals.delete(path);

    const tab = this.tabs.get(path);
    tab?.parentElement?.remove();
    this.tabs.delete(path);

    if (this.activeFile === path) {
      this.activeFile = null;
      const next = this.tabs.keys().next();
      if (!next.done) {
        const nextPath = next.value;
        const nextTab = this.tabs.get(nextPath);
        this.activateFile(nextPath, nextTab?.textContent || undefined);
      } else {
        const newPath = `untitled-${this.untitledCounter++}`;
        const model = editor.createModel('', 'markdown');
        this.models.set(newPath, model);
        this.originals.set(newPath, '');
        this.addTab(`Untitled ${this.untitledCounter - 1}`, newPath);
        this.activateFile(newPath, `Untitled ${this.untitledCounter - 1}`);
      }
    }
  }

  private activateFile(path: string, name?: string) {
    const mdl = this.models.get(path);
    if (!mdl) {
      return;
    }

    this.activeFile = path;
    this.model.setModel(mdl);
    const filename = name || path.split(/[\\/]/).pop() || '';
    dom.meta.file.active.innerText = filename;

    this.dispatcher.setTrackedContent({
      content: this.originals.get(path) ?? '',
    });

    this.trackEditorStateBetweenExecutionContext(
      this.originals.get(path) ?? '',
      this.model.getValue(),
    );

    this.tabs.forEach((tab, p) => {
      if (p === path) tab.classList.add('active');
      else tab.classList.remove('active');
    });

    if (dom.filetree) {
      dom.filetree.querySelectorAll('li.file .file-name').forEach((el) => {
        const li = (el as HTMLElement).parentElement as HTMLElement;
        if (li.dataset.path === path)
          (el as HTMLElement).classList.add('active');
        else (el as HTMLElement).classList.remove('active');
      });
    }

    this.dispatcher.render();
    this.model.focus();

    this.bridge.send('to:title:set', filename === '' ? 'New File' : filename);
  }

  private buildFileTree(tree: any[]) {
    if (!dom.filetree) return;
    dom.filetree.innerHTML = '';
    const build = (nodes: any[], parent: HTMLElement) => {
      nodes.forEach((node) => {
        const li = document.createElement('li');
        li.classList.add('ft-node', node.type);

        const span = document.createElement('span');
        span.classList.add('file-name');
        const icon = document.createElement('i');
        icon.className =
          node.type === 'directory' ? 'fa fa-folder me-1' : 'fa fa-file me-1';
        span.appendChild(icon);
        span.append(node.name);
        li.appendChild(span);

        if (node.type === 'directory') {
          const ul = document.createElement('ul');
          ul.classList.add('list-unstyled', 'ps-3');
          build(node.children, ul);
          li.appendChild(ul);
        } else {
          li.classList.add('file');
          li.dataset.path = node.path;
          span.addEventListener('click', (e) => {
            e.preventDefault();
            this.openFileFromPath(node.path);
          });
        }
        parent.appendChild(li);
      });
    };
    build(tree, dom.filetree);
  }

  public openFileFromPath(path: string) {
    this.openingFile = true;
    if (this.models.has(path)) {
      this.activateFile(path);
      this.openingFile = false;
      return;
    }
    if (this.contentHasChanged && this.activeFile !== path) {
      this.bridge.send('to:file:save', {
        content: this.model.getValue(),
        file: this.activeFile,
        prompt: true,
        openPath: path,
      });
      if (this.activeFile) {
        this.originals.set(this.activeFile, this.model.getValue());
        this.dispatcher.setTrackedContent({
          content: this.model.getValue(),
        });
      }
    } else {
      this.bridge.send('to:file:openpath', path);
    }
  }

  /**
   * Track the editor state between both exection contexts.
   *
   * @param original - the original loaded state of the editor
   * @param current  - the current state of the editor
   */
  public trackEditorStateBetweenExecutionContext(
    original: string,
    current: string,
  ) {
    this.bridge.send('to:editor:state', { original, current });
    this.contentHasChanged = original !== current;
  }

  /**
   * private method to load settings for the editor model, used by the
   * from:settings:set bridge channel receiver.
   *
   * @param settings - the editor settings to load
   */
  private loadSettingsFromStorageChannel(settings: EditorSettings) {
    this.model.updateOptions({
      autoIndent: settings.autoindent ? 'advanced' : 'none',
    });

    this.model.updateOptions({
      wordWrap: settings.wordwrap ? 'on' : 'off',
    });

    this.model.updateOptions({
      renderWhitespace: settings.whitespace ? 'all' : 'none',
    });

    this.model.updateOptions({
      minimap: { enabled: settings.minimap },
    });
  }
}
