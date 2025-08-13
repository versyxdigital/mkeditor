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

  /** counter for untitled files */
  private untitledCounter = 1;

  /** Flag to indicate that a file is being opened */
  private openingFile = false;

  /** Flag to indicate a new root folder is being opened */
  private openingFolder = false;

  /** Root path for the current file tree */
  private treeRoot: string | null = null;

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

    // Draggable file tabs event listener
    dom.tabs?.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dom.tabs) {
        return;
      }

      const after = this.getDragAfterElement(dom.tabs, e.clientX);
      const dragging = dom.tabs.querySelector(
        'li.dragging',
      ) as HTMLLIElement | null;

      if (!dragging) {
        return;
      }

      if (after == null) {
        dom.tabs.appendChild(dragging);
      } else {
        dom.tabs.insertBefore(dragging, after);
      }
    });

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
    li.draggable = true;
    li.dataset.path = path;
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = name;
    a.draggable = false;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      this.activateFile(path);
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.classList.add('tab-close');
    close.innerHTML = '&times;';
    close.draggable = false;
    close.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await this.closeTab(path);
    });

    li.addEventListener('dragstart', () => {
      li.classList.add('dragging');
    });

    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      this.syncTabOrder();
    });

    li.appendChild(a);
    li.appendChild(close);
    dom.tabs?.appendChild(li);
    this.tabs.set(path, a);
  }

  /**
   * Close an open file tab.
   *
   * @param path - the path to the file being closed
   * @returns
   */
  private async closeTab(path: string) {
    const mdl = this.models.get(path);
    if (!mdl) {
      return;
    }

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

  /**
   * Synchronize the tab order from drag.
   *
   * @returns
   */
  private syncTabOrder() {
    if (!dom.tabs) return;
    const newMap: Map<string, HTMLAnchorElement> = new Map();
    dom.tabs.querySelectorAll('li').forEach((li) => {
      const path = (li as HTMLLIElement).dataset.path;
      if (!path) return;
      const anchor = this.tabs.get(path);
      if (anchor) newMap.set(path, anchor);
    });
    this.tabs = newMap;
  }

  /**
   * Get the tab element from drag.
   *
   * @param container - editor tabs
   * @param x - tab offset inedx
   * @returns
   */
  private getDragAfterElement(container: HTMLElement, x: number) {
    const elements = Array.from(
      container.querySelectorAll('li:not(.dragging)'),
    ) as HTMLElement[];
    let closest: { offset: number; element: HTMLElement | null } = {
      offset: Number.NEGATIVE_INFINITY,
      element: null,
    };
    for (const child of elements) {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) {
        closest = { offset, element: child };
      }
    }
    return closest.element;
  }

  /**
   * Activate a file.
   *
   * @param path - the file path
   * @param name - the file name
   * @returns
   */
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

  /**
   * Build the file explorer tree.
   *
   * @param tree - the file tree
   * @param parentPath - the parent path
   * @returns
   */
  private buildFileTree(tree: any[], parentPath: string) {
    if (!dom.filetree) {
      return;
    }

    let parent: HTMLElement;
    if (!this.treeRoot || parentPath === this.treeRoot) {
      dom.filetree.innerHTML = '';
      parent = dom.filetree;
    } else {
      const selector = `li.directory[data-path="${CSS.escape(parentPath)}"]`;
      const li = dom.filetree.querySelector(selector) as HTMLElement | null;
      if (!li) {
        return;
      }

      const ul = li.querySelector(':scope > ul') as HTMLElement | null;
      if (!ul) {
        return;
      }
      ul.innerHTML = '';
      ul.dataset.loaded = 'true';
      parent = ul;
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
          const ul = document.createElement('ul');
          ul.classList.add('list-unstyled', 'ps-3');
          ul.style.display = 'none';
          li.appendChild(ul);

          span.addEventListener('click', () => {
            const isOpen = ul.style.display !== 'none';
            if (isOpen) {
              ul.style.display = 'none';
              chevron.innerHTML = '<i class="fa fa-chevron-right"></i>';
              icon.innerHTML = '<i class="fa fa-folder"></i>';
            } else {
              ul.style.display = '';
              chevron.innerHTML = '<i class="fa fa-chevron-down"></i>';
              icon.innerHTML = '<i class="fa fa-folder-open"></i>';
              if (!ul.dataset.loaded && node.hasChildren) {
                this.bridge.send('to:file:openpath', { path: node.path });
              }
            }
          });
        } else {
          li.classList.add('file');
          li.dataset.path = node.path;
          span.addEventListener('click', (e) => {
            e.preventDefault();
            this.openFileFromPath(node.path);
          });
        }
        parentEl.appendChild(li);
      });
    };

    build(tree, parent);
  }

  /**
   * Add a file to the file explorer tree.
   *
   * @param path - the path to the file to add
   * @returns
   */
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

    let parentUl: HTMLElement = dom.filetree;
    let currentPath = this.treeRoot;

    for (let i = 0; i < rel.length - 1; i++) {
      const dir = rel[i];
      currentPath += sep + dir;
      const dirLi = Array.from(
        parentUl.querySelectorAll(':scope > li.directory'),
      ).find((el) => (el as HTMLElement).dataset.path === currentPath) as
        | HTMLElement
        | undefined;
      if (!dirLi) {
        return;
      }
      const span = dirLi.querySelector(
        ':scope > span.file-name',
      ) as HTMLElement;
      const ul = dirLi.querySelector(':scope > ul') as HTMLElement;
      if (!ul) return;
      if (ul.style.display === 'none') {
        span.dispatchEvent(new Event('click'));
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

    span.addEventListener('click', (e) => {
      e.preventDefault();
      this.openFileFromPath(path);
    });

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
