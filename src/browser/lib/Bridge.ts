import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { ContextBridgeAPI, ContextBridgedFile } from '../interfaces/Bridge';
import { BridgeProviders, ValidModal } from '../interfaces/Providers';
import { EditorSettings } from '../interfaces/Editor';
import { EditorDispatcher } from '../events/EditorDispatcher';
import { Notify } from './Notify';
import { dom } from '../dom';
import Swal from 'sweetalert2';

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

  /** Map of directory <ul> elements */
  private directoryMap: Map<string, HTMLElement> = new Map();

  /** counter for untitled files */
  private untitledCounter = 1;

  /** Flag to indicate that a file is being opened */
  private openingFile = false;

  /** Flag to indicate a new root folder is being opened */
  private openingFolder = false;

  /** Root path for the current file tree */
  private treeRoot: string | null = null;

  /** Flag to track file tree listener registration */
  private fileTreeListenerRegistered = false;

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
      if (this.activeFile && !this.activeFile.startsWith('untitled')) {
        this.bridge.send(channel, {
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
    });

    this.bridge.receive('from:file:saveas', (channel: string) => {
      this.bridge.send(channel, this.model.getValue());
    });

    // Handle opening folders and constructing file tree
    this.bridge.receive('from:folder:open', (channel: string) => {
      this.openingFolder = true;
      this.bridge.send(channel, true);
    });

    this.bridge.receive('from:folder:opened', ({ tree, path }) => {
      if (
        this.openingFolder ||
        !this.treeRoot ||
        !path.startsWith(this.treeRoot)
      ) {
        this.treeRoot = path;
        this.openingFolder = false;
      }
      this.buildFileTree(tree, path);
    });

    // Enable opening files from outside of the renderer execution context.
    this.bridge.receive('from:file:open', (channel: string) => {
      this.openingFile = true;
      this.bridge.send(channel, true);
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
            const newTab = tab.cloneNode(true) as HTMLAnchorElement;
            newTab.textContent = name;
            newTab.addEventListener('click', (e) => {
              e.preventDefault();
              this.activateFile(path);
            });
            tab.replaceWith(newTab);

            this.models.set(path, mdl);
            this.tabs.set(path, newTab);
            this.originals.set(path, content);

            mdl.setValue(content);

            const closeBtn =
              newTab.nextElementSibling as HTMLButtonElement | null;
            if (closeBtn) {
              const newBtn = closeBtn.cloneNode(true) as HTMLButtonElement;
              newBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await this.closeTab(path);
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

        this.addFileToTree(path);
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
    close.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await this.closeTab(path);
    });

    li.appendChild(a);
    li.appendChild(close);
    dom.tabs?.appendChild(li);
    this.tabs.set(path, a);
  }

  private async closeTab(path: string) {
    const mdl = this.models.get(path);
    if (!mdl) return;

    const original = this.originals.get(path) ?? '';
    const current = mdl.getValue();

    if (original !== current) {
      const result = await Swal.fire({
        customClass: {
          container: 'unsaved-changes-popup',
        },
        title: 'Unsaved changes',
        text: 'Save changes to your file before closing?',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Save & close',
        denyButtonText: 'Close without saving',
        cancelButtonText: 'Cancel',
      });

      if (result.isConfirmed) {
        if (path.startsWith('untitled')) {
          this.bridge.send('to:file:saveas', current);
        } else {
          this.bridge.send('to:file:save', {
            content: current,
            file: path,
            openFile: false,
          });
        }
      } else if (!result.isDenied) {
        return;
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

    const original = this.originals.get(path) ?? '';
    const current = this.model.getValue();

    this.dispatcher.setTrackedContent({ content: original });
    this.trackEditorStateBetweenExecutionContext(original !== current);

    this.tabs.forEach((tab, p) => {
      const li = tab.parentElement as HTMLElement;
      if (p === path) {
        li.classList.add('active');
      } else li.classList.remove('active');
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

  private buildFileTree(tree: any[], parentPath: string) {
    if (!dom.filetree) {
      return;
    }

    if (!this.fileTreeListenerRegistered) {
      dom.filetree.addEventListener('click', this.handleFileTreeClick);
      this.fileTreeListenerRegistered = true;
    }

    let parent: HTMLElement;
    if (!this.treeRoot || parentPath === this.treeRoot) {
      dom.filetree.innerHTML = '';
      parent = dom.filetree;
      this.directoryMap.clear();
      this.directoryMap.set(parentPath, dom.filetree);
    } else {
      const ul = this.directoryMap.get(parentPath);
      if (!ul) {
        return;
      }
      ul.innerHTML = '';
      ul.dataset.loaded = 'true';
      parent = ul;

      const li = ul.parentElement as HTMLElement | null;
      if (tree.length === 0 && li) {
        li.dataset.hasChildren = 'false';
        const chevron = li.querySelector(
          ':scope > span.file-name > span:first-child',
        );
        chevron?.firstElementChild?.classList.add('invisible');
      }
    }

    const build = (nodes: any[], parentEl: HTMLElement) => {
      const sorted = [...nodes].sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name, undefined, {
            sensitivity: 'base',
          });
        }
        return a.type === 'directory' ? -1 : 1;
      });
      const fragment = document.createDocumentFragment();
      sorted.forEach((node) => {
        const li = document.createElement('li');
        li.classList.add('ft-node', node.type);

        const span = document.createElement('span');
        span.classList.add('file-name');

        const chevron = document.createElement('span');
        chevron.classList.add('me-1');
        chevron.innerHTML = '<i class="fa fa-chevron-right"></i>';
        if (node.type !== 'directory' || !node.hasChildren) {
          chevron.firstElementChild?.classList.add('invisible');
        }
        chevron.style.display = 'inline-block';
        chevron.style.fontSize = '0.7em';
        span.appendChild(chevron);

        const icon = document.createElement('span');
        icon.classList.add('me-1');
        icon.innerHTML =
          node.type === 'directory'
            ? '<i class="fa fa-folder"></i>'
            : '<i class="fa fa-file"></i>';
        span.appendChild(icon);
        span.append(node.name);
        li.appendChild(span);

        if (node.type === 'directory') {
          li.dataset.path = node.path;
          li.dataset.hasChildren = node.hasChildren ? 'true' : 'false';
          const ul = document.createElement('ul');
          ul.classList.add('list-unstyled', 'ps-3');
          ul.style.display = 'none';
          li.appendChild(ul);
          this.directoryMap.set(node.path, ul);
        } else {
          li.classList.add('file');
          li.dataset.path = node.path;
        }
        fragment.appendChild(li);
      });
      parentEl.appendChild(fragment);
    };

    build(tree, parent);
  }

  /**
   * Handle file tree click events.
   *
   * @param e - the click event
   * @returns
   */
  private handleFileTreeClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const span = target.closest('span.file-name');
    if (!span) {
      return;
    }

    const li = span.parentElement as HTMLElement;
    if (!li) {
      return;
    }

    if (li.classList.contains('directory')) {
      const ul = li.querySelector(':scope > ul') as HTMLElement | null;
      if (!ul) {
        return;
      }

      const chevron = span.firstElementChild as HTMLElement;
      const icon = chevron?.nextElementSibling as HTMLElement;
      const isOpen = ul.style.display !== 'none';

      if (isOpen) {
        ul.style.display = 'none';
        chevron.innerHTML = '<i class="fa fa-chevron-right"></i>';
        icon.innerHTML = '<i class="fa fa-folder"></i>';
      } else {
        ul.style.display = '';
        chevron.innerHTML = '<i class="fa fa-chevron-down"></i>';
        icon.innerHTML = '<i class="fa fa-folder-open"></i>';
        if (
          !ul.dataset.loaded &&
          li.dataset.hasChildren === 'true' &&
          li.dataset.path
        ) {
          this.bridge.send('to:file:openpath', { path: li.dataset.path });
        }
      }
    } else if (li.classList.contains('file') && li.dataset.path) {
      e.preventDefault();
      this.openFileFromPath(li.dataset.path);
    }
  };

  private addFileToTree(path: string) {
    if (!dom.filetree || !this.treeRoot) {
      return;
    }

    if (!path.startsWith(this.treeRoot)) {
      return;
    }

    const sep = this.treeRoot.includes('\\') ? '\\' : '/';
    const segments = path.split(/[/\\]/);
    const rootSegments = this.treeRoot.split(/[/\\]/);
    const rel = segments.slice(rootSegments.length);

    let currentPath = this.treeRoot;
    let parentUl = this.directoryMap.get(currentPath) || dom.filetree;
    if (!parentUl) {
      return;
    }

    for (let i = 0; i < rel.length - 1; i++) {
      const dir = rel[i];
      currentPath += sep + dir;

      const ul = this.directoryMap.get(currentPath);
      if (!ul) {
        return;
      }

      if (ul.style.display === 'none') {
        const span = ul.previousElementSibling as HTMLElement;
        span?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }

      parentUl = ul;
    }

    const fileName = rel[rel.length - 1];
    const existing = Array.from(
      parentUl.querySelectorAll(':scope > li.file'),
    ).find((el) => (el as HTMLElement).dataset.path === path);
    if (existing) {
      return;
    }

    const li = document.createElement('li');
    li.classList.add('ft-node', 'file');
    li.dataset.path = path;

    const span = document.createElement('span');
    span.classList.add('file-name');

    const chevron = document.createElement('span');
    chevron.classList.add('me-1');
    chevron.innerHTML = '<i class="fa fa-chevron-right"></i>';
    chevron.firstElementChild?.classList.add('invisible');
    chevron.style.display = 'inline-block';
    chevron.style.fontSize = '0.7em';
    span.appendChild(chevron);

    const icon = document.createElement('span');
    icon.classList.add('me-1');
    icon.innerHTML = '<i class="fa fa-file"></i>';
    span.appendChild(icon);
    span.append(fileName);

    li.appendChild(span);

    const fileNodes = Array.from(
      parentUl.querySelectorAll(':scope > li.file'),
    ) as HTMLElement[];
    const before = fileNodes.find((el) => {
      const nameEl = el.querySelector(':scope > span.file-name');
      const name = nameEl?.textContent?.trim() || '';
      return (
        fileName.localeCompare(name, undefined, { sensitivity: 'base' }) < 0
      );
    });
    if (before) {
      parentUl.insertBefore(li, before);
    } else {
      parentUl.appendChild(li);
    }
  }

  /**
   * Open a file from a given path.
   *
   * @param path - the file path to open
   */
  public openFileFromPath(path: string) {
    this.openingFile = true;

    if (this.models.has(path)) {
      this.activateFile(path);
      this.openingFile = false;
      return;
    }

    if (this.contentHasChanged && this.activeFile !== path) {
      // Update the tracked content so the existing file retains its unsaved state
      this.dispatcher.setTrackedContent({
        content: this.model.getValue(),
      });
    }

    this.bridge.send('to:file:openpath', { path });
  }

  /**
   * Track the editor state between both exection contexts.
   *
   * @param hasChanged - whether the editor content has changed
   */
  public trackEditorStateBetweenExecutionContext(hasChanged: boolean) {
    this.bridge.send('to:editor:state', hasChanged);
    this.contentHasChanged = hasChanged;
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
