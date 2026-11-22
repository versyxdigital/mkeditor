import { HTMLExporter } from './HTMLExporter';
import { WORKSPACE_EXTENSIONS_DOTTED } from '../../app/shared/fileExtensions';
import type { ContextBridgeAPI } from '../interfaces/Bridge';
import type {
  SessionPayload,
  SessionRestoreEnvelope,
  SessionTab,
} from '../interfaces/Session';
import { logger } from '../util';

/**
 * Clamp a paste-image extension to a known image format.
 */
function normalizeImageExtension(extension: string): string {
  const lowered = extension.replace(/^\.+/, '').toLowerCase();
  const allowed = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);
  return allowed.has(lowered) ? lowered : 'png';
}

/**
 * Resolve `.`/`..` segments in a virtual workspace path.
 */
export function normalizeVirtualPath(input: string, rootName: string): string {
  const segments = input.split('/').filter((s) => s.length > 0);
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '.') continue;
    if (seg === '..') {
      // Clamp at the root.
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(seg);
  }
  if (out.length === 0 || out[0] !== rootName) {
    return rootName;
  }
  return out.join('/');
}

/**
 * Must stay in sync with `AppStorage.buildPastedImageBasename`.
 */
function buildPastedImageBasename(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `img_${now.getFullYear()}${pad(now.getMonth() + 1)}` +
    `${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}` +
    `${pad(now.getSeconds())}`
  );
}

const IDB_NAME = 'mkeditor';
const IDB_STORE = 'handles';
const IDB_VERSION = 1;
const ROOT_KEY = 'workspace-root';

/** localStorage key for the persisted session. */
const LS_KEY_SESSION = 'mkeditor-session';

/**
 * Legacy localStorage key used pre-session-restore to mirror the
 * single Monaco buffer. Migrated into the first untitled tab of a
 * freshly-written session on the first launch then removed.
 */
const LS_KEY_LEGACY_CONTENT = 'mkeditor-content';

type Handle = FileSystemFileHandle | FileSystemDirectoryHandle;

interface TreeEntry {
  type: 'file' | 'directory';
  name: string;
  path: string;
  hasChildren?: boolean;
}

type SaveResult =
  | { ok: true; path: string }
  | { ok: false; cancelled?: boolean; error?: string };

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
  private pendingRoot: {
    handle: FileSystemDirectoryHandle;
    handles: Map<string, Handle>;
  } | null = null;
  private imageWriteQueue: Promise<void> = Promise.resolve();

  // ContextBridgeAPI ---------------------------------------------------

  send(channel: string, data: any): void {
    switch (channel) {
      case 'to:folder:open':
        void this.openFolder();
        break;
      case 'to:file:open':
        void this.openFile();
        break;
      case 'to:file:new':
        this.emit('from:file:opened', { content: '', file: null });
        break;
      case 'to:folder:create':
        void this.createFolder(data.parent, data.name);
        break;
      case 'to:file:openpath':
        void this.openPath(data.path);
        break;
      case 'to:file:save':
        void this.saveFile(data.file, data.content, data.requestId);
        break;
      case 'to:file:saveas':
        void this.saveAs(
          typeof data === 'string' ? data : data.content,
          typeof data === 'string' ? undefined : data.requestId,
          typeof data === 'string' ? [] : data.excludedPaths,
        );
        break;
      case 'to:workspace:set':
        if (this.pendingRoot && this.pendingRoot.handle.name === data?.root) {
          const pending = this.pendingRoot;
          this.pendingRoot = null;
          this.rootHandle = pending.handle;
          this.rootName = pending.handle.name;
          this.handles = pending.handles;
          void saveRootHandle(pending.handle);
        }
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
      case 'to:shell:openpath':
        void this.openPathExternal(data.path);
        break;
      case 'to:html:export':
        HTMLExporter.webExport(data.content, 'text/html', '.html');
        break;
      case 'to:pdf:export':
        HTMLExporter.pdfWebExport(data.content);
        break;
      case 'to:session:save':
        this.persistSession(data as SessionPayload);
        break;
      case 'to:session:clear':
        this.clearSession();
        break;
      case 'to:title:set':
      case 'to:editor:state':
      case 'to:settings:save':
      case 'to:i18n:set':
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
   * Forget the current workspace. Drops the in-memory root reference,
   * deletes the persisted handle from IndexedDB, and clears the path
   * map. Currently-open tabs are intentionally left alone — they
   * remain functional within this session via their cached handles,
   * but the user can no longer browse or auto-restore the folder.
   */
  public async disconnectWorkspace(): Promise<void> {
    this.rootHandle = null;
    this.rootName = '';
    this.handles = new Map();
    this.pendingRoot = null;
    try {
      await deleteRootHandle();
    } catch (err) {
      logger?.error('WebFileBridge.disconnect', JSON.stringify(err));
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

  // Session persistence -------------------------------------

  /**
   * One-shot boot sequence for web mode. Attempts a silent workspace
   * restore, runs the legacy-content migration, then ships the
   * persisted session over `from:session:restore` (mirroring main
   * process's did-finish-load behaviour on desktop). Also installs the
   * `beforeunload` flush listener so the final cursor/tab state lands
   * in localStorage before the page goes away.
   */
  public async bootstrap(): Promise<void> {
    await this.restoreWorkspace(false);
    await this.shipSessionRestore();
    this.installBeforeUnloadFlush();
  }

  /**
   * Persist the session payload to localStorage. Synchronous — survives
   * a `beforeunload` flush. Any error (quota exceeded, storage
   * disabled) is logged and swallowed; the renderer keeps running.
   */
  private persistSession(payload: SessionPayload): boolean {
    try {
      localStorage.setItem(LS_KEY_SESSION, JSON.stringify(payload));
      return true;
    } catch (err) {
      logger?.error('WebFileBridge.persistSession', JSON.stringify(err));
      return false;
    }
  }

  /**
   * Wipe the persisted session from localStorage. Mirrors desktop's
   * `AppSession.clear`. Currently-open tabs stay open; the next launch
   * reads no session and lands on a fresh untitled. Fires the same
   * `notifications:session_cleared` toast desktop does.
   */
  private clearSession(): void {
    try {
      localStorage.removeItem(LS_KEY_SESSION);
    } catch (err) {
      logger?.error('WebFileBridge.clearSession', JSON.stringify(err));
    }
    this.emit('from:notification:display', {
      status: 'success',
      key: 'notifications:session_cleared',
    });
  }

  /**
   * Build and emit the `from:session:restore` envelope. Real-file
   * paths are validated against the rebuilt handle map (only populated
   * when workspace restore succeeded earlier in `bootstrap`); missing
   * paths feed the same toast pipeline desktop uses. Legacy
   * `mkeditor-content` is migrated inline and the old key removed.
   */
  private async shipSessionRestore(): Promise<void> {
    const raw = (() => {
      try {
        return localStorage.getItem(LS_KEY_SESSION);
      } catch {
        return null;
      }
    })();

    let payload: SessionPayload | null = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<SessionPayload>;
        if (
          parsed &&
          (parsed.version === 1 || parsed.version === 2) &&
          Array.isArray(parsed.tabs) &&
          (parsed.activeFile === null || typeof parsed.activeFile === 'string')
        ) {
          payload = {
            version: parsed.version,
            tabs: parsed.tabs.filter(
              (tab): tab is SessionTab =>
                !!tab &&
                typeof tab === 'object' &&
                typeof tab.path === 'string' &&
                typeof tab.name === 'string' &&
                (tab.untitledContent === undefined ||
                  typeof tab.untitledContent === 'string'),
            ),
            activeFile: parsed.activeFile ?? null,
            // workspaceRoot is desktop-only; web rebuilds via the
            // IDB handle map regardless of what was persisted.
            workspaceRoot: null,
          };
        }
      } catch {
        // Drop malformed session — better to start fresh.
      }
    }

    payload = this.applyLegacyContentMigration(payload);

    if (!payload) {
      this.emit('from:session:restore', {
        session: null,
        missing: [],
        contents: {},
      } satisfies SessionRestoreEnvelope);
      return;
    }

    const missing: string[] = [];
    const kept: SessionTab[] = [];
    const contents: Record<string, string> = {};

    for (const tab of payload.tabs) {
      if (tab.path.startsWith('untitled-')) {
        kept.push(tab);
        continue;
      }
      const handle = await this.lookupHandle(tab.path);
      if (!handle || handle.kind !== 'file') {
        missing.push(tab.path);
        continue;
      }
      try {
        const file = await handle.getFile();
        contents[tab.path] = await file.text();
        kept.push(tab);
      } catch {
        missing.push(tab.path);
      }
    }

    const activeStillPresent =
      payload.activeFile !== null &&
      kept.some((t) => t.path === payload!.activeFile);

    this.emit('from:session:restore', {
      session: {
        version: payload.version,
        tabs: kept,
        activeFile: activeStillPresent ? payload.activeFile : null,
        workspaceRoot: this.rootHandle ? this.rootName : null,
      },
      missing,
      contents,
    } satisfies SessionRestoreEnvelope);
  }

  /**
   * If a legacy `mkeditor-content` localStorage entry exists (left
   * behind by pre-session-restore versions of the app), absorb it as
   * the first untitled tab of the returned session and remove the old
   * key. Only fires when the session doesn't already track an
   * untitled tab with content — otherwise we'd be reintroducing stale
   * data the user already moved past.
   */
  private applyLegacyContentMigration(
    payload: SessionPayload | null,
  ): SessionPayload | null {
    let legacy: string | null;
    try {
      legacy = localStorage.getItem(LS_KEY_LEGACY_CONTENT);
    } catch {
      legacy = null;
    }
    if (!legacy || legacy.length === 0) {
      // Clean up empty-string entries from older builds while we're here.
      try {
        if (legacy !== null) localStorage.removeItem(LS_KEY_LEGACY_CONTENT);
      } catch {
        // ignore
      }
      return payload;
    }

    const hasUntitledWithContent = payload?.tabs.some(
      (t) => t.path.startsWith('untitled-') && t.untitledContent,
    );

    if (!hasUntitledWithContent) {
      const migrated: SessionTab = {
        path: 'untitled-1',
        name: 'Untitled 1',
        viewState: null,
        untitledContent: legacy,
      };
      const existing =
        payload?.tabs.filter((t) => t.path !== 'untitled-1') ?? [];
      payload = {
        version: payload?.version ?? 2,
        tabs: [migrated, ...existing],
        activeFile: payload?.activeFile ?? 'untitled-1',
        workspaceRoot: payload?.workspaceRoot ?? null,
      };
      // Do not delete the only durable copy until its replacement is saved.
      if (!this.persistSession(payload)) return payload;
    }

    try {
      localStorage.removeItem(LS_KEY_LEGACY_CONTENT);
    } catch {
      // ignore
    }
    return payload;
  }

  /**
   * Install the beforeunload flush listener. Mirrors desktop's
   * `before-quit` hook: emits `from:session:flush-request` so
   * BridgeListeners synchronously serializes + sends one final
   * `to:session:save`. localStorage writes are synchronous, so by
   * the time `beforeunload` returns, the session is on disk.
   */
  private installBeforeUnloadFlush(): void {
    if (typeof window === 'undefined' || this.beforeUnloadInstalled) return;
    this.beforeUnloadInstalled = true;
    window.addEventListener('beforeunload', () => {
      this.emit('from:session:flush-request');
    });
  }

  private beforeUnloadInstalled = false;

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
      const handles = new Map<string, Handle>([[handle.name, handle]]);
      const tree = await this.listChildren(handle, handle.name, handles);
      this.pendingRoot = { handle, handles };
      this.emit('from:folder:opened', {
        path: handle.name,
        tree,
        workspaceChange: true,
      });
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_open_folder',
      });
    }
  }

  private async activateRoot(handle: FileSystemDirectoryHandle): Promise<void> {
    const handles = new Map<string, Handle>([[handle.name, handle]]);
    const tree = await this.listChildren(handle, handle.name, handles);
    this.rootHandle = handle;
    this.rootName = handle.name;
    this.handles = handles;
    await saveRootHandle(handle);
    this.emit('from:folder:opened', { path: this.rootName, tree });
  }

  private async openFile(): Promise<void> {
    if (typeof window.showOpenFilePicker !== 'function') {
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_open_file',
      });
      return;
    }
    const root = this.rootHandle;
    const cache = this.handles;
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'Markdown',
            accept: { 'text/markdown': ['.md', '.txt'] },
          },
        ],
      });
      if (!handle) return;
      const content = await (await handle.getFile()).text();
      this.assertWorkspace(root, cache);
      let path = await this.findPathOfFileHandle(handle);
      this.assertWorkspace(root, cache);
      if (!path) {
        path = `external/${handle.name}`;
        let index = 2;
        while (this.handles.has(path))
          path = `external/${index++}/${handle.name}`;
      }
      this.handles.set(path, handle);
      this.emit('from:file:opened', { content, file: path });
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return;
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_open_file',
      });
    }
  }

  /** Resolve a saved nested path without requiring its parents to be expanded. */
  private async lookupHandle(path: string): Promise<Handle | undefined> {
    const cache = this.handles;
    const root = this.rootHandle;
    const rootName = this.rootName;
    const cached = cache.get(path);
    if (cached) return cached;
    const segments = path.split('/');
    if (
      !root ||
      segments[0] !== rootName ||
      segments.some(
        (segment) => !segment || segment === '.' || segment === '..',
      )
    )
      return undefined;
    let current = root;
    let cursor = rootName;
    try {
      for (let index = 1; index < segments.length; index++) {
        cursor += `/${segments[index]}`;
        if (index === segments.length - 1) {
          const file = await current.getFileHandle(segments[index], {
            create: false,
          });
          if (this.rootHandle !== root || this.handles !== cache)
            return undefined;
          cache.set(cursor, file);
          return file;
        }
        current = await current.getDirectoryHandle(segments[index], {
          create: false,
        });
        if (this.rootHandle !== root || this.handles !== cache)
          return undefined;
        cache.set(cursor, current);
      }
    } catch {
      // Missing or inaccessible paths are reported as missing by restore.
    }
    return undefined;
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

  /**
   * Web counterpart of the desktop `to:shell:openpath` IPC.
   */
  private async openPathExternal(path: string): Promise<void> {
    const handle = this.handles.get(path);
    if (!handle || handle.kind !== 'file') {
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_open_path',
      });
      return;
    }
    try {
      const file = await handle.getFile();
      const url = URL.createObjectURL(file);
      let opened: Window | null;
      try {
        opened = window.open(url, '_blank');
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
      if (!opened) {
        URL.revokeObjectURL(url);
        this.emit('from:notification:display', {
          status: 'error',
          key: 'notifications:unable_open_path',
        });
        return;
      }
      // Keep the URL long enough for native PDF/image viewers to consume
      // it, then release the Blob rather than retaining it until tab exit.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      logger?.error('WebFileBridge.openPathExternal', JSON.stringify(err));
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_open_path',
      });
    }
  }

  private async listChildren(
    handle: FileSystemDirectoryHandle,
    basePath: string,
    cache = this.handles,
  ): Promise<TreeEntry[]> {
    const items: TreeEntry[] = [];
    for await (const [name, child] of handle.entries()) {
      const fullPath = `${basePath}/${name}`;
      if (child.kind === 'directory') {
        cache.set(fullPath, child);
        items.push({
          type: 'directory',
          name,
          path: fullPath,
          hasChildren: true,
        });
      } else {
        const lower = name.toLowerCase();
        const dot = lower.lastIndexOf('.');
        if (dot >= 0 && WORKSPACE_EXTENSIONS_DOTTED.has(lower.slice(dot))) {
          cache.set(fullPath, child);
          items.push({ type: 'file', name, path: fullPath });
        }
      }
    }
    return items;
  }

  // Save ---------------------------------------------------------------

  private replySave(requestId: string | undefined, result: SaveResult): void {
    if (requestId) this.emit('from:file:save-result', { requestId, ...result });
  }

  private async saveFile(
    path: string,
    content: string,
    requestId?: string,
  ): Promise<void> {
    try {
      const handle = await this.lookupHandle(path);
      if (!handle || handle.kind !== 'file')
        throw new Error('File handle is unavailable.');
      await writeFileHandle(handle, content);
      this.replySave(requestId, { ok: true, path });
      this.emit('from:notification:display', {
        status: 'success',
        key: 'notifications:saved_markdown_success',
      });
    } catch (err) {
      this.replySave(requestId, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      logger?.error('WebFileBridge.save', JSON.stringify(err));
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_save_markdown',
      });
    }
  }

  private async saveAs(
    content: string,
    requestId?: string,
    excludedPaths: string[] = [],
  ): Promise<void> {
    const root = this.rootHandle;
    const cache = this.handles;
    if (typeof window.showSaveFilePicker !== 'function') {
      this.replySave(requestId, {
        ok: false,
        error: 'File save is unavailable.',
      });
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
          { description: 'Markdown', accept: { 'text/markdown': ['.md'] } },
        ],
      });
      this.assertWorkspace(root, cache);
      let virtualPath = await this.findPathOfFileHandle(handle);
      this.assertWorkspace(root, cache);
      if (virtualPath && excludedPaths.includes(virtualPath)) {
        throw new Error('The destination is already open in another tab.');
      }
      await writeFileHandle(handle, content);
      this.assertWorkspace(root, cache);
      if (!virtualPath) {
        virtualPath = `external/${handle.name}`;
        let index = 2;
        while (this.handles.has(virtualPath)) {
          virtualPath = `external/${index++}/${handle.name}`;
        }
      }
      this.handles.set(virtualPath, handle);
      if (!requestId)
        this.emit('from:file:opened', { content, file: virtualPath });
      this.replySave(requestId, { ok: true, path: virtualPath });
      this.emit('from:notification:display', {
        status: 'success',
        key: 'notifications:saved_markdown_success',
      });
      if (this.rootHandle && virtualPath.startsWith(`${this.rootName}/`)) {
        const parentPath = virtualPath.slice(0, virtualPath.lastIndexOf('/'));
        const parent = this.handles.get(parentPath);
        if (parent?.kind === 'directory') {
          try {
            const tree = await this.listChildren(parent, parentPath);
            this.emit('from:folder:opened', { path: parentPath, tree });
          } catch {
            // The saved file remains usable even when listing fails.
          }
        }
      }
    } catch (err) {
      const cancelled = (err as DOMException)?.name === 'AbortError';
      this.replySave(requestId, {
        ok: false,
        cancelled,
        error: cancelled
          ? undefined
          : err instanceof Error
            ? err.message
            : String(err),
      });
      if (cancelled) return;
      logger?.error('WebFileBridge.saveAs', JSON.stringify(err));
      this.emit('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_save_markdown',
      });
    }
  }

  private assertWorkspace(
    root: FileSystemDirectoryHandle | null,
    cache: Map<string, Handle>,
  ): void {
    if (this.rootHandle !== root || this.handles !== cache) {
      throw new Error('The workspace changed during the file operation.');
    }
  }

  private async findPathOfFileHandle(
    target: FileSystemFileHandle,
  ): Promise<string | null> {
    const root = this.rootHandle;
    const cache = this.handles;
    const rootName = this.rootName;
    for (const [path, handle] of cache) {
      if (handle.kind !== 'file') continue;
      if (handle === target) return path;
      let same = false;
      try {
        same = await target.isSameEntry(handle);
      } catch {
        // Cross-origin handles cannot be compared.
      }
      this.assertWorkspace(root, cache);
      if (same) return path;
    }
    if (root && typeof root.resolve === 'function') {
      const segments = await root.resolve(target);
      this.assertWorkspace(root, cache);
      if (segments?.length) {
        let parent = root;
        let cursor = rootName;
        for (const segment of segments.slice(0, -1)) {
          parent = await parent.getDirectoryHandle(segment, { create: false });
          this.assertWorkspace(root, cache);
          cursor += `/${segment}`;
          cache.set(cursor, parent);
        }
        return `${rootName}/${segments.join('/')}`;
      }
    }
    return null;
  }

  // Paste-image -------------------------------------------------------

  /**
   * Save pasted-image bytes into the virtual workspace and return the
   * virtual path.
   */
  public pasteImage(opts: {
    sourceFile: string;
    directory: string;
    bytes: Uint8Array;
    extension: string;
  }): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    const root = this.rootHandle;
    const pending = this.imageWriteQueue.then(() => {
      if (this.rootHandle !== root) {
        return {
          ok: false as const,
          error: 'The workspace changed before the image was saved.',
        };
      }
      return this.writePastedImage(opts);
    });
    this.imageWriteQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async writePastedImage(opts: {
    sourceFile: string;
    directory: string;
    bytes: Uint8Array;
    extension: string;
  }): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    if (!this.rootHandle) {
      return { ok: false, error: 'No folder is open in the editor.' };
    }
    const root = this.rootHandle;
    const cache = this.handles;
    try {
      if (
        !opts.sourceFile.replace(/\\/g, '/').startsWith(`${this.rootName}/`)
      ) {
        throw new Error('The source file is outside the workspace.');
      }
      const targetDir = this.resolvePasteTargetDir(
        opts.sourceFile,
        opts.directory,
      );
      const dirHandle = await this.ensureVirtualDirectory(targetDir);
      const safeExt = normalizeImageExtension(opts.extension);
      const baseName = buildPastedImageBasename(new Date());
      const finalName = await this.allocatePastedImageNameWeb(
        dirHandle,
        baseName,
        safeExt,
      );
      this.assertWorkspace(root, cache);
      const fileHandle = await dirHandle.getFileHandle(finalName, {
        create: true,
      });
      // Copy into a fresh ArrayBuffer.
      const buffer = new ArrayBuffer(opts.bytes.byteLength);
      new Uint8Array(buffer).set(opts.bytes);
      await writeFileHandle(fileHandle, buffer);
      this.assertWorkspace(root, cache);
      const fullPath = `${targetDir}/${finalName}`;
      this.handles.set(fullPath, fileHandle);
      // Refresh the file-tree row for the target directory.
      try {
        const tree = await this.listChildren(dirHandle, targetDir);
        this.emit('from:folder:opened', { path: targetDir, tree });
      } catch {
        // The image was saved; explorer refresh is best effort.
      }
      return { ok: true, path: fullPath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /**
   * Resolve the user's `directory` setting against `sourceFile`'s
   * virtual directory.
   */
  private resolvePasteTargetDir(sourceFile: string, directory: string): string {
    const sourceDir = sourceFile
      .replace(/\\/g, '/')
      .split('/')
      .slice(0, -1)
      .join('/');

    let trimmed = directory.replace(/\\/g, '/').trim();
    while (trimmed.startsWith('./')) trimmed = trimmed.slice(2);

    let anchorRoot = false;
    if (trimmed.startsWith('/')) {
      anchorRoot = true;
      trimmed = trimmed.slice(1);
    }

    while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);

    let combined: string;
    if (anchorRoot) {
      combined = trimmed ? `${this.rootName}/${trimmed}` : this.rootName;
    } else if (sourceDir) {
      combined = trimmed ? `${sourceDir}/${trimmed}` : sourceDir;
    } else {
      combined = trimmed ? `${this.rootName}/${trimmed}` : this.rootName;
    }

    return normalizeVirtualPath(combined, this.rootName);
  }

  /**
   * Walk into `virtualPath` from the workspace root, creating any
   * intermediate directories that don't yet exist.
   */
  private async ensureVirtualDirectory(
    virtualPath: string,
  ): Promise<FileSystemDirectoryHandle> {
    const root = this.rootHandle;
    const cache = this.handles;
    if (!root) throw new Error('No workspace is open.');
    const segments = virtualPath.split('/').filter((s) => s.length > 0);
    if (segments.length === 0 || segments[0] !== this.rootName) {
      throw new Error(`Path is outside the workspace: ${virtualPath}`);
    }
    let current: FileSystemDirectoryHandle = root;
    let cursor = this.rootName;
    for (let i = 1; i < segments.length; i++) {
      cursor = `${cursor}/${segments[i]}`;
      current = await current.getDirectoryHandle(segments[i], { create: true });
      this.assertWorkspace(root, cache);
      cache.set(cursor, current);
    }
    return current;
  }

  /**
   * Sibling to `AppStorage.allocatePastedImageName`.
   */
  private async allocatePastedImageNameWeb(
    dir: FileSystemDirectoryHandle,
    baseName: string,
    extension: string,
  ): Promise<string> {
    const candidate = (n: number) =>
      n === 1 ? `${baseName}.${extension}` : `${baseName}_${n}.${extension}`;
    for (let n = 1; n <= 1000; n++) {
      const name = candidate(n);
      if (!(await entryExists(dir, name))) return name;
    }
    throw new Error('Unable to allocate an unused image filename.');
  }

  // Create / rename / delete -------------------------------------------

  private async createFile(parentPath: string, name: string): Promise<void> {
    const parent = this.handles.get(parentPath);
    if (!parent || parent.kind !== 'directory') return;
    try {
      if (await entryExists(parent, name))
        throw new Error('File already exists.');
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
    if (name === handle.name) return;
    const parentPath = path.slice(0, path.lastIndexOf('/'));
    const result =
      !name || name === '.' || name === '..' || /[\\/]/.test(name)
        ? { ok: false as const }
        : await this.moveItem({
            srcPath: path,
            dstPath: `${parentPath}/${name}`,
          });
    this.emit('from:notification:display', {
      status: result.ok ? 'success' : 'error',
      key: result.ok
        ? 'notifications:renamed_success'
        : 'notifications:unable_rename',
    });
  }

  /**
   * Move a file or folder inside the virtual workspace. Mirrors
   * `AppStorage.moveItem` on desktop so `BridgeManager.moveItem`
   * can route through one interface from React.
   *
   * Strategy:
   *   - Validate that both src and dst remain inside the open
   *     workspace (the rest of the API only exposes the granted
   *     root anyway, but we check explicitly so a typo in
   *     `dstPath` returns a structured error instead of throwing
   *     into the user's face).
   *   - Refuse collisions, self-into-self, and self-into-descendant
   *     so behaviour matches the desktop side.
   *   - Use copy + delete via the same `copyDirectory` helper
   *     `rename` uses. The native
   *     `FileSystemDirectoryHandle.move()` is still origin-locked
   *     in some Chromium builds, and the copy path works the same
   *     for files and directories.
   *   - Emit `from:folder:opened` for both ends and
   *     `from:path:renamed` so open-tab paths update.
   */
  public async moveItem(opts: {
    srcPath: string;
    dstPath: string;
  }): Promise<
    | { ok: true; oldPath: string; newPath: string }
    | { ok: false; error: string }
  > {
    const { srcPath, dstPath } = opts;
    try {
      if (!this.rootHandle) {
        return { ok: false, error: 'No folder is open in the editor.' };
      }
      // Both ends must stay rooted under the workspace name. We
      // check this explicitly because the cached `handles` map
      // returns nothing for out-of-workspace paths, and we want a
      // structured `outside the workspace` error rather than a
      // generic "no handle".
      const requireInside = (p: string) => {
        const segments = p.split('/');
        if (
          segments[0] !== this.rootName ||
          segments.some(
            (segment) =>
              !segment ||
              segment === '.' ||
              segment === '..' ||
              segment.includes('\\'),
          )
        ) {
          throw new Error(`Path is outside the workspace: ${p}`);
        }
      };
      requireInside(srcPath);
      requireInside(dstPath);

      if (srcPath === dstPath) {
        return { ok: false, error: 'destination_same_as_source' };
      }
      if (dstPath === srcPath || dstPath.startsWith(`${srcPath}/`)) {
        return { ok: false, error: 'destination_inside_source' };
      }

      const srcHandle = this.handles.get(srcPath);
      if (!srcHandle) {
        return { ok: false, error: 'File not found' };
      }

      const lastSlash = dstPath.lastIndexOf('/');
      if (lastSlash === -1) {
        return { ok: false, error: 'destination_parent_missing' };
      }
      const dstParentPath = dstPath.slice(0, lastSlash);
      const dstName = dstPath.slice(lastSlash + 1);
      if (!dstName) {
        return { ok: false, error: 'destination_parent_missing' };
      }

      // Resolve / create the destination parent. `ensureVirtualDirectory`
      // walks the cached handle tree, creating intermediate
      // directories on demand — for `moveItem` we want a missing
      // parent to refuse rather than silently spawn a path. Check
      // existence in the cache; if the cache doesn't have it, fall
      // back to a stricter walk that only succeeds when each
      // intermediate already exists.
      let dstParent: FileSystemDirectoryHandle | null = null;
      const cachedParent = this.handles.get(dstParentPath);
      if (cachedParent && cachedParent.kind === 'directory') {
        dstParent = cachedParent;
      } else {
        const segments = dstParentPath.split('/').filter(Boolean);
        if (segments[0] !== this.rootName) {
          return { ok: false, error: 'destination_parent_missing' };
        }
        let walker: FileSystemDirectoryHandle = this.rootHandle;
        try {
          for (let i = 1; i < segments.length; i++) {
            walker = await walker.getDirectoryHandle(segments[i], {
              create: false,
            });
          }
          dstParent = walker;
        } catch {
          return { ok: false, error: 'destination_parent_missing' };
        }
      }

      if (await entryExists(dstParent, dstName)) {
        return { ok: false, error: 'destination_exists' };
      }

      // Copy + remove. Same primitives `renamePath` uses.
      const srcParentPath = srcPath.slice(0, srcPath.lastIndexOf('/'));
      const srcParent =
        srcParentPath === this.rootName
          ? this.rootHandle
          : this.handles.get(srcParentPath);
      if (!srcParent || srcParent.kind !== 'directory') {
        return { ok: false, error: 'File not found' };
      }

      if (srcHandle.kind === 'file') {
        const newHandle = await dstParent.getFileHandle(dstName, {
          create: true,
        });
        const original = await srcHandle.getFile();
        await writeFileHandle(newHandle, await original.arrayBuffer());
        await srcParent.removeEntry(srcHandle.name);
        this.handles.delete(srcPath);
        this.handles.set(dstPath, newHandle);
      } else {
        const newDir = await dstParent.getDirectoryHandle(dstName, {
          create: true,
        });
        await copyDirectory(srcHandle, newDir);
        await srcParent.removeEntry(srcHandle.name, { recursive: true });
        // Forget every cached descendant of the old path.
        for (const key of [...this.handles.keys()]) {
          if (key === srcPath || key.startsWith(`${srcPath}/`)) {
            this.handles.delete(key);
          }
        }
        this.handles.set(dstPath, newDir);
      }

      // Refresh both ends. Source parent loses an entry; dest
      // parent gains one.
      try {
        const srcTree = await this.listChildren(srcParent, srcParentPath);
        this.emit('from:folder:opened', {
          path: srcParentPath,
          tree: srcTree,
        });
      } catch {
        // non-fatal
      }
      try {
        const dstTree = await this.listChildren(dstParent, dstParentPath);
        this.emit('from:folder:opened', {
          path: dstParentPath,
          tree: dstTree,
        });
      } catch {
        // non-fatal
      }

      this.emit('from:path:renamed', {
        oldPath: srcPath,
        newPath: dstPath,
        name: dstName,
      });

      return { ok: true, oldPath: srcPath, newPath: dstPath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
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

async function entryExists(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await parent.getFileHandle(name, { create: false });
    return true;
  } catch (error) {
    if ((error as DOMException).name === 'TypeMismatchError') return true;
    if ((error as DOMException).name === 'NotFoundError') return false;
    throw error;
  }
}

/** Abort failed writable streams so abandoned locks and partial writes are released. */
async function writeFileHandle(
  handle: FileSystemFileHandle,
  content: string | ArrayBuffer,
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(content);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      /* best effort */
    }
    throw error;
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
      const file = await child.getFile();
      await writeFileHandle(newFile, await file.arrayBuffer());
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
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(handle, ROOT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch (err) {
    logger?.error('WebFileBridge.persist', JSON.stringify(err));
  }
}

async function deleteRootHandle(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(ROOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    try {
      return await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(ROOT_KEY);
        req.onsuccess = () =>
          resolve((req.result as FileSystemDirectoryHandle) ?? null);
        req.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
