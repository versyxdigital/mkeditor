import { HTMLExporter } from './HTMLExporter';
import type { ContextBridgeAPI } from '../interfaces/Bridge';
import { logger } from '../util';

const IDB_NAME = 'mkeditor';
const IDB_STORE = 'handles';
const IDB_VERSION = 1;
const ROOT_KEY = 'workspace-root';

type Handle = FileSystemFileHandle | FileSystemDirectoryHandle;

interface TreeEntry {
  type: 'file' | 'directory';
  name: string;
  path: string;
  hasChildren?: boolean;
}

/**
 * Bridge implementation for the web build, backed by the File System
 * Access API. Implements the same `ContextBridgeAPI` surface the
 * Electron preload provides on desktop so the rest of the renderer
 * (BridgeManager, FileManager, FileTreeManager, BridgeListeners)
 * stays mode-agnostic.
 *
 * Paths are virtual: rooted at the workspace folder's name (e.g.
 * `my-notes/sub/foo.md`). Each known path maps to a FileSystemHandle
 * in `this.handles`. The root handle is also persisted to IndexedDB
 * so the workspace survives reload — re-attaching it on the next
 * boot requires only a single permission re-prompt on the user's
 * first click.
 *
 * Only Chromium-based browsers ship the API in full. On Firefox/
 * Safari, `window.showDirectoryPicker` is undefined; `openFolder()`
 * surfaces a notification and aborts.
 */
export class WebFileBridge implements ContextBridgeAPI {
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private rootName = '';
  private handles = new Map<string, Handle>();
  private listeners = new Map<string, Array<(...args: any[]) => void>>();

  // ContextBridgeAPI ---------------------------------------------------

  send(channel: string, data: any): void {
    switch (channel) {
    case 'to:folder:open':
      void this.openFolder();
      break;
    case 'to:folder:create':
      void this.createFolder(data.parent, data.name);
      break;
    case 'to:file:openpath':
      void this.openPath(data.path);
      break;
    case 'to:file:save':
      void this.saveFile(data.file, data.content);
      break;
    case 'to:file:saveas':
      void this.saveAs(data);
      break;
    case 'to:file:create':
      void this.createFile(data.parent, data.name);
      break;
    case 'to:file:rename':
      void this.renamePath(data.path, data.name);
      break;
    case 'to:file:delete':
      void this.deletePath(data.path);
      break;
    case 'to:file:properties':
      void this.showProperties(data.path);
      break;
    case 'to:html:export':
      HTMLExporter.webExport(data.content, 'text/html', '.html');
      break;
    case 'to:pdf:export':
      HTMLExporter.pdfWebExport(data.content);
      break;
    case 'to:title:set':
    case 'to:editor:state':
    case 'to:settings:save':
    case 'to:i18n:set':
    case 'to:file:new':
      break;
    }
  }

  receive(channel: string, fn: (...args: any[]) => void): void {
    let arr = this.listeners.get(channel);
    if (!arr) {
      arr = [];
      this.listeners.set(channel, arr);
    }
    arr.push(fn);
  }

  private emit(channel: string, ...args: any[]) {
    (this.listeners.get(channel) ?? []).forEach((fn) => fn(...args));
  }

  // Workspace restore --------------------------------------------------

  /**
   * True if a previously-opened workspace handle is stored in IDB
   * and we already have permission for it. Used by the composition
   * root to decide whether to auto-open the sidebar on boot.
   */
  public async hasRestorableWorkspace(): Promise<boolean> {
    try {
      const handle = await loadRootHandle();
      if (!handle) return false;
      const state = await handle.queryPermission?.({ mode: 'readwrite' });
      return state === 'granted';
    } catch {
      return false;
    }
  }

  /**
   * Re-open the persisted workspace handle. Returns true on success.
   * `interactive: true` will call `requestPermission` (showing the
   * one-tap re-grant prompt) if needed; `interactive: false` only
   * succeeds when permission is already `granted`.
   */
  public async restoreWorkspace(interactive: boolean): Promise<boolean> {
    try {
      const handle = await loadRootHandle();
      if (!handle) return false;
      let state = await handle.queryPermission?.({ mode: 'readwrite' });
      if (state !== 'granted' && interactive) {
        state = await handle.requestPermission?.({ mode: 'readwrite' });
      }
      if (state !== 'granted') return false;
      await this.activateRoot(handle);
      return true;
    } catch (err) {
      logger?.error('WebFileBridge.restore', JSON.stringify(err));
      return false;
    }
  }

  // Folder open + walk -------------------------------------------------

  private async openFolder(): Promise<void> {
    if (typeof window.showDirectoryPicker !== 'function') {
      this.emit('from:notification:display', {
        status: 'error',
        message: 'Your browser does not support directory access.',
      });
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({
        id: 'mkeditor-root',
        mode: 'readwrite',
      });
      await this.activateRoot(handle);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_open_folder',
      });
    }
  }

  private async activateRoot(
    handle: FileSystemDirectoryHandle,
  ): Promise<void> {
    this.rootHandle = handle;
    this.rootName = handle.name;
    this.handles.clear();
    this.handles.set(this.rootName, handle);
    await saveRootHandle(handle);
    const tree = await this.listChildren(handle, this.rootName);
    this.emit('from:folder:opened', { path: this.rootName, tree });
  }

  private async openPath(path: string): Promise<void> {
    const handle = this.handles.get(path);
    if (!handle) {
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:path_not_exist',
      });
      return;
    }
    if (handle.kind === 'directory') {
      const tree = await this.listChildren(handle, path);
      this.emit('from:folder:opened', { path, tree });
    } else {
      try {
        const file = await handle.getFile();
        const content = await file.text();
        this.emit('from:file:opened', { content, file: path });
      } catch (err) {
        logger?.error('WebFileBridge.openFile', JSON.stringify(err));
        this.emit('from:notification:display', {
          status: 'error',
          key: 'notifications:unable_open_file',
        });
      }
    }
  }

  private async listChildren(
    handle: FileSystemDirectoryHandle,
    basePath: string,
  ): Promise<TreeEntry[]> {
    const items: TreeEntry[] = [];
    for await (const [name, child] of handle.entries()) {
      const fullPath = `${basePath}/${name}`;
      if (child.kind === 'directory') {
        this.handles.set(fullPath, child);
        items.push({
          type: 'directory',
          name,
          path: fullPath,
          hasChildren: true,
        });
      } else if (name.toLowerCase().endsWith('.md')) {
        this.handles.set(fullPath, child);
        items.push({ type: 'file', name, path: fullPath });
      }
    }
    return items;
  }

  // Save ---------------------------------------------------------------

  private async saveFile(path: string, content: string): Promise<void> {
    const handle = this.handles.get(path);
    if (!handle || handle.kind !== 'file') {
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_save_markdown',
      });
      return;
    }
    try {
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      this.emit('from:notification:display', {
        status: 'success',
        key: 'notifications:saved_markdown_success',
      });
    } catch (err) {
      logger?.error('WebFileBridge.save', JSON.stringify(err));
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_save_markdown',
      });
    }
  }

  private async saveAs(content: string): Promise<void> {
    if (typeof window.showSaveFilePicker !== 'function') {
      this.emit('from:notification:display', {
        status: 'error',
        message: 'Your browser does not support file save.',
      });
      return;
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'untitled.md',
        types: [
          {
            description: 'Markdown',
            accept: { 'text/markdown': ['.md'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();

      let virtualPath: string | null = null;
      // If the save landed inside the open workspace, surface it in
      // the tree and refresh its parent directory.
      if (this.rootHandle) {
        virtualPath = await this.findPathOfFileHandle(handle);
        if (virtualPath) {
          const lastSep = virtualPath.lastIndexOf('/');
          const parentPath = virtualPath.slice(0, lastSep);
          const parentHandle = this.handles.get(parentPath);
          if (parentHandle && parentHandle.kind === 'directory') {
            const tree = await this.listChildren(parentHandle, parentPath);
            this.emit('from:folder:opened', { path: parentPath, tree });
          }
        }
      }

      if (!virtualPath) {
        // Foreign save target — track under a synthetic prefix so the
        // FileManager can use it as a tab key.
        virtualPath = `external/${handle.name}`;
        this.handles.set(virtualPath, handle);
      }

      this.emit('from:file:opened', { content, file: virtualPath });
      this.emit('from:notification:display', {
        status: 'success',
        key: 'notifications:saved_markdown_success',
      });
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      logger?.error('WebFileBridge.saveAs', JSON.stringify(err));
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_save_markdown',
      });
    }
  }

  private async findPathOfFileHandle(
    target: FileSystemFileHandle,
  ): Promise<string | null> {
    for (const [path, handle] of this.handles) {
      if (handle.kind !== 'file') continue;
      try {
        if (await target.isSameEntry(handle)) return path;
      } catch {
        // ignore — isSameEntry can throw on cross-origin handles
      }
    }
    return null;
  }

  // Create / rename / delete -------------------------------------------

  private async createFile(parentPath: string, name: string): Promise<void> {
    const parent = this.handles.get(parentPath);
    if (!parent || parent.kind !== 'directory') return;
    try {
      const fileHandle = await parent.getFileHandle(name, { create: true });
      const fullPath = `${parentPath}/${name}`;
      this.handles.set(fullPath, fileHandle);
      const tree = await this.listChildren(parent, parentPath);
      this.emit('from:folder:opened', { path: parentPath, tree });
      this.emit('from:notification:display', {
        status: 'success',
        key: 'notifications:file_created',
      });
    } catch (err) {
      logger?.error('WebFileBridge.createFile', JSON.stringify(err));
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_create_file',
      });
    }
  }

  private async createFolder(parentPath: string, name: string): Promise<void> {
    const parent = this.handles.get(parentPath);
    if (!parent || parent.kind !== 'directory') return;
    try {
      const dirHandle = await parent.getDirectoryHandle(name, { create: true });
      const fullPath = `${parentPath}/${name}`;
      this.handles.set(fullPath, dirHandle);
      const tree = await this.listChildren(parent, parentPath);
      this.emit('from:folder:opened', { path: parentPath, tree });
      this.emit('from:notification:display', {
        status: 'success',
        key: 'notifications:folder_created',
      });
    } catch (err) {
      logger?.error('WebFileBridge.createFolder', JSON.stringify(err));
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_create_folder',
      });
    }
  }

  private async renamePath(path: string, name: string): Promise<void> {
    const handle = this.handles.get(path);
    if (!handle) return;

    const lastSep = path.lastIndexOf('/');
    if (lastSep === -1) return; // can't rename the root
    const parentPath = path.slice(0, lastSep);
    const parent = this.handles.get(parentPath);
    if (!parent || parent.kind !== 'directory') return;

    // The File System Access API has no rename primitive — copy then
    // remove. Directories require a recursive walk.
    try {
      if (handle.kind === 'file') {
        const newHandle = await parent.getFileHandle(name, { create: true });
        const writable = await newHandle.createWritable();
        const original = await handle.getFile();
        await writable.write(await original.arrayBuffer());
        await writable.close();
        await parent.removeEntry(handle.name);
        const newPath = `${parentPath}/${name}`;
        this.handles.delete(path);
        this.handles.set(newPath, newHandle);
        this.emit('from:path:renamed', { oldPath: path, newPath, name });
      } else {
        const newDir = await parent.getDirectoryHandle(name, { create: true });
        await copyDirectory(handle, newDir);
        await parent.removeEntry(handle.name, { recursive: true });
        // Forget every cached descendant — paths have moved.
        for (const key of [...this.handles.keys()]) {
          if (key === path || key.startsWith(`${path}/`)) {
            this.handles.delete(key);
          }
        }
        const newPath = `${parentPath}/${name}`;
        this.handles.set(newPath, newDir);
      }
      const tree = await this.listChildren(parent, parentPath);
      this.emit('from:folder:opened', { path: parentPath, tree });
      this.emit('from:notification:display', {
        status: 'success',
        key: 'notifications:renamed_success',
      });
    } catch (err) {
      logger?.error('WebFileBridge.rename', JSON.stringify(err));
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_rename',
      });
    }
  }

  private async deletePath(path: string): Promise<void> {
    const handle = this.handles.get(path);
    if (!handle) return;
    const lastSep = path.lastIndexOf('/');
    if (lastSep === -1) return; // can't delete the root
    const parentPath = path.slice(0, lastSep);
    const parent = this.handles.get(parentPath);
    if (!parent || parent.kind !== 'directory') return;

    try {
      await parent.removeEntry(handle.name, { recursive: true });
      // Drop the entry and any descendants from the cache.
      for (const key of [...this.handles.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) {
          this.handles.delete(key);
        }
      }
      const tree = await this.listChildren(parent, parentPath);
      this.emit('from:folder:opened', { path: parentPath, tree });
      this.emit('from:notification:display', {
        status: 'success',
        key: 'notifications:deleted_success',
      });
    } catch (err) {
      logger?.error('WebFileBridge.delete', JSON.stringify(err));
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_delete',
      });
    }
  }

  private async showProperties(path: string): Promise<void> {
    const handle = this.handles.get(path);
    if (!handle) return;
    let size = '—';
    let modified = '';
    if (handle.kind === 'file') {
      try {
        const file = await handle.getFile();
        size =
          file.size >= 1024 * 1024
            ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
            : `${(file.size / 1024).toFixed(2)} KB`;
        modified = new Date(file.lastModified).toISOString();
      } catch {
        // ignore — surface partial properties
      }
    }
    this.emit('from:path:properties', {
      path,
      isDirectory: handle.kind === 'directory',
      size,
      // The File System Access API doesn't surface creation time;
      // mirror `modified` so the modal still has something to show.
      created: modified,
      modified,
    });
  }
}

// Recursive directory copy used by rename ----------------------------

async function copyDirectory(
  source: FileSystemDirectoryHandle,
  target: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const [name, child] of source.entries()) {
    if (child.kind === 'file') {
      const newFile = await target.getFileHandle(name, { create: true });
      const writable = await newFile.createWritable();
      const file = await child.getFile();
      await writable.write(await file.arrayBuffer());
      await writable.close();
    } else {
      const newDir = await target.getDirectoryHandle(name, { create: true });
      await copyDirectory(child, newDir);
    }
  }
}

// IndexedDB persistence ----------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveRootHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, ROOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    logger?.error('WebFileBridge.persist', JSON.stringify(err));
  }
}

async function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(ROOT_KEY);
      req.onsuccess = () =>
        resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
