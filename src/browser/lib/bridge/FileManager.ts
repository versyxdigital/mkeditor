import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import Swal from 'sweetalert2';
import { ContextBridgeAPI } from '../../interfaces/Bridge';
import { EditorDispatcher } from '../../events/EditorDispatcher';
import { dom } from '../../dom';

/**
 * Handle editor files, models and tabs.
 */
export class FileManager {
  /** The current active file */
  public activeFile: string | null = null;

  /** Flag to determine whether the content has changed */
  public contentHasChanged = false;

  /** Map of open file models */
  public models: Map<string, editor.ITextModel> = new Map();

  /** Map of original contents */
  public originals: Map<string, string> = new Map();

  /** Map of tab elements */
  public tabs: Map<string, HTMLAnchorElement> = new Map();

  /** counter for untitled files */
  public untitledCounter = 1;

  /** Flag to indicate that a file is being opened */
  public openingFile = false;

  /** Is the app log */
  private isLogFile: boolean = false;

  /**
   * Create a new file manager instance.
   *
   * @param bridge - the execution bridge
   * @param mkeditor - the editor instance
   * @param dispatcher - the event dispatcher
   */
  constructor(
    private bridge: ContextBridgeAPI,
    private mkeditor: editor.IStandaloneCodeEditor,
    private dispatcher: EditorDispatcher,
  ) {}

  /**
   * Add a new tab for an activated file.
   *
   * @param name - the file name
   * @param path - the file path
   */
  public addTab(name: string, path: string) {
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
   * Close a tab (check for saved changes).
   *
   * @param path - the file path
   * @returns
   */
  public async closeTab(path: string) {
    const mdl = this.models.get(path);
    if (!mdl) return;

    const original = this.originals.get(path) ?? '';
    const current = mdl.getValue();

    if (original !== current && !this.isLogFile) {
      const result = await Swal.fire({
        customClass: { container: 'unsaved-changes-popup' },
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
   * Synchronize the order of the tabs after reordering.
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
   * Get the next tab element from the drag.
   *
   * @param container - the tabs container
   * @param x - the tab index offset
   * @returns
   */
  public getDragAfterElement(container: HTMLElement, x: number) {
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
   * Activate a file upon opening it.
   *
   * @param path - the file path
   * @param name - the file name
   * @returns
   */
  public activateFile(path: string, name?: string) {
    const mdl = this.models.get(path);
    if (!mdl) {
      return;
    }

    this.activeFile = path;
    this.mkeditor.setModel(mdl);
    const filename = name || path.split(/[\\/]/).pop() || '';
    dom.meta.file.active.innerText = filename;

    const original = this.originals.get(path) ?? '';
    const current = this.mkeditor.getValue();

    this.isLogFile = filename.endsWith('.log');

    if (!this.isLogFile) {
      this.dispatcher.setTrackedContent({ content: original });
      this.trackContentHasChanged(original !== current);
    } else {
      this.contentHasChanged = false;
    }

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
    this.mkeditor.focus();

    this.bridge.send('to:title:set', filename === '' ? 'New File' : filename);
  }

  /**
   * Open a file from a given path.
   *
   * @param path - the file path
   * @returns
   */
  public openFileFromPath(path: string) {
    this.openingFile = true;

    if (this.models.has(path)) {
      this.activateFile(path);
      this.openingFile = false;
      return;
    }

    if (this.contentHasChanged && this.activeFile !== path) {
      this.dispatcher.setTrackedContent({
        content: this.mkeditor.getValue(),
      });
    }

    this.bridge.send('to:file:openpath', { path });
  }

  /**
   * Track the editor state (contents) on the active file.
   *
   * @param hasChanged - whether the state has changed
   * @returns
   */
  public trackContentHasChanged(hasChanged: boolean) {
    if (this.isLogFile) hasChanged = false;
    this.bridge.send('to:editor:state', hasChanged);
    this.contentHasChanged = hasChanged;
  }

  /**
   * Save the active file contents.
   * @returns
   */
  public saveContentToFile() {
    if (this.activeFile && !this.activeFile.startsWith('untitled')) {
      this.bridge.send('to:file:save', {
        content: this.mkeditor.getValue(),
        file: this.activeFile,
      });
      this.originals.set(this.activeFile, this.mkeditor.getValue());
      this.dispatcher.setTrackedContent({
        content: this.mkeditor.getValue(),
      });
    } else {
      this.bridge.send('to:file:saveas', this.mkeditor.getValue());
    }
  }

  /**
   * Export an active file preview to HTML
   *
   * @param content - the preview HTML content
   * @returns
   */
  public exportPreviewToFile(content: string) {
    this.bridge.send('to:html:export', { content });
  }
}
