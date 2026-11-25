import { app, dialog, type BrowserWindow } from 'electron';
import {
  readFileSync,
  realpathSync,
  statSync,
  lstatSync,
  linkSync,
  copyFileSync,
  unlinkSync,
  promises as fs,
  constants as fsConstants,
} from 'fs';
import { randomUUID } from 'crypto';
import {
  basename,
  join,
  dirname,
  relative,
  resolve,
  isAbsolute,
  sep,
} from 'path';
import type {
  SaveFileOptions,
  WorkspaceFileListing,
} from '../interfaces/Storage';
import { WORKSPACE_EXTENSIONS_DOTTED } from '../shared/fileExtensions';
import { WorkspaceMutationGuard } from './WorkspaceMutationGuard';

export const WORKSPACE_LISTING_LIMITS = {
  files: 5000,
  directories: 1000,
  entries: 20000,
} as const;
const EXCLUDED_LISTING_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
]);

/**
 * AppStorage
 */
export class AppStorage {
  /** The active file path */
  private static activeFilePath: string | null = null;
  private static readonly textWrites = new Map<string, Promise<void>>();
  private static readonly saveDestinations = new WeakMap<
    BrowserWindow,
    Set<string>
  >();

  private static savePathKey(path: string): string {
    return process.platform === 'win32' ? path.toLowerCase() : path;
  }

  private static canonicalSavePath(path: string): string {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
      throw new Error('Invalid save destination');
    try {
      return realpathSync.native(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return join(realpathSync.native(dirname(path)), basename(path));
    }
  }

  /** Main-only grant after a native open/selection, checked workspace open or restore. */
  static authorizeFile(context: BrowserWindow, path: string): void {
    const canonical = realpathSync.native(path);
    let destinations = AppStorage.saveDestinations.get(context);
    if (!destinations) {
      destinations = new Set();
      AppStorage.saveDestinations.set(context, destinations);
    }
    destinations.add(AppStorage.savePathKey(canonical));
  }

  private static isSaveAuthorized(
    context: BrowserWindow,
    canonical: string,
  ): boolean {
    return (
      AppStorage.saveDestinations
        .get(context)
        ?.has(AppStorage.savePathKey(canonical)) ?? false
    );
  }

  /** Preserve grants for open documents when main successfully moves their backing paths. */
  static moveFileAuthorization(
    context: BrowserWindow,
    source: string,
    destination: string,
  ): void {
    const grants = AppStorage.saveDestinations.get(context);
    if (!grants) return;
    const from = AppStorage.savePathKey(source);
    const to = AppStorage.savePathKey(destination);
    for (const path of [...grants]) {
      if (path === from || path.startsWith(from + sep)) {
        grants.delete(path);
        grants.add(to + path.slice(from.length));
      }
    }
  }

  /** Serialize menu and tool writes to the same canonical file. */
  static async writeTextFile(
    path: string,
    content: string,
    encoding: BufferEncoding = 'utf-8',
  ): Promise<void> {
    let key = resolve(path);
    try {
      key = realpathSync.native(key);
    } catch {
      // A new file may still have a symlinked parent. Queue both aliases
      // under that canonical directory before the first write creates it.
      try {
        key = join(realpathSync.native(dirname(key)), basename(key));
      } catch {
        /* The eventual write reports a missing/inaccessible parent. */
      }
    }
    if (process.platform === 'win32') key = key.toLowerCase();
    const previous = AppStorage.textWrites.get(key) ?? Promise.resolve();
    const write = previous
      .catch(() => {})
      .then(() => fs.writeFile(path, content, { encoding }));
    AppStorage.textWrites.set(key, write);
    try {
      await write;
    } finally {
      if (AppStorage.textWrites.get(key) === write)
        AppStorage.textWrites.delete(key);
    }
  }

  /**
   * The currently-open workspace root, or null when no folder is open.
   *
   * This is the **trust boundary** for the `mked:fs:*` IPC handlers
   * exposed via `window.mked` to the renderer. Without scoping, those
   * handlers would let a compromised renderer (XSS in a previewed
   * doc, malicious mked:// link, agent-gone-wrong, future plugin)
   * read or overwrite arbitrary user files. Every file-level invoke
   * resolves the requested path to canonical form (`fs.realpath` so
   * symlinks can't escape) and rejects anything that doesn't sit
   * inside this root. When the root is null, fs invokes are denied
   * outright — the user must open a folder first.
   *
   * Updated by the `to:workspace:set` IPC channel, which the renderer
   * fires from `BridgeListeners.from:folder:opened` only when the
   * tree adopts a new root (lazy sub-loads don't touch this).
   */
  private static workspaceRoot: string | null = null;
  private static offeredWorkspaceRoot: string | null = null;
  private static restoringWorkspaceRoot: string | null = null;

  static getWorkspaceRoot(): string | null {
    return AppStorage.workspaceRoot;
  }

  static workspaceMutationGuard(): WorkspaceMutationGuard {
    const root = AppStorage.workspaceRoot;
    if (!root) throw new Error('No workspace is open.');
    return new WorkspaceMutationGuard(root, (directory, expected) =>
      AppStorage.verifyWorkspaceDirectory(directory, root, expected),
    );
  }

  /** Synchronous guard for a canonical directory immediately before mutation. */
  static verifyWorkspaceDirectory(
    directory: string,
    root: string,
    expected?: { dev: number; ino: number; birthtimeMs: number },
  ): { dev: number; ino: number; birthtimeMs: number } {
    if (AppStorage.workspaceRoot !== root)
      throw new Error('Workspace changed during the batch.');
    const canonical = realpathSync.native(directory);
    const rel = relative(root, canonical);
    const stat = lstatSync(directory);
    if (
      relative(directory, canonical) !== '' ||
      rel === '..' ||
      rel.startsWith('..' + sep) ||
      isAbsolute(rel) ||
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      (expected &&
        (stat.dev !== expected.dev ||
          stat.ino !== expected.ino ||
          stat.birthtimeMs !== expected.birthtimeMs))
    )
      throw new Error(
        `Workspace directory changed or is symbolic: ${directory}`,
      );
    return { dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs };
  }

  /** Filename metadata for references, independent of the explorer's lazy/filter state. */
  static async listWorkspaceFiles(root: string): Promise<WorkspaceFileListing> {
    const workspace = AppStorage.workspaceRoot;
    // Directory operations may address the root itself. opendir below still
    // requires it to exist; the canonical containment check remains enforced.
    const safeRoot = await AppStorage.assertInWorkspace(root, {
      mustExist: false,
    });
    if (!workspace || safeRoot !== workspace)
      throw new Error('Workspace changed or invalid workspace root.');
    const displayRoot = resolve(root);
    const pending = [displayRoot];
    const files: string[] = [];
    let directories = 1;
    let entries = 0;
    let truncated = false;
    const checkWorkspace = () => {
      if (AppStorage.workspaceRoot !== workspace)
        throw new Error('Workspace changed during file listing.');
    };
    scan: while (pending.length > 0) {
      checkWorkspace();
      const directory = pending.pop()!;
      try {
        const safe = await AppStorage.assertInWorkspace(directory, {
          mustExist: false,
        });
        checkWorkspace();
        // Stream entries so a single huge directory cannot allocate an
        // unbounded array before the traversal budget is checked.
        const handle = await fs.opendir(safe);
        for await (const entry of handle) {
          checkWorkspace();
          if (++entries > WORKSPACE_LISTING_LIMITS.entries) {
            truncated = true;
            break scan;
          }
          const path = join(directory, entry.name);
          if (entry.isDirectory()) {
            if (
              entry.name.startsWith('.') ||
              EXCLUDED_LISTING_DIRECTORIES.has(entry.name.toLowerCase())
            )
              continue;
            if (directories >= WORKSPACE_LISTING_LIMITS.directories) {
              truncated = true;
              continue;
            }
            directories++;
            pending.push(path);
          } else if (entry.isFile()) files.push(path);
          else if (entry.isSymbolicLink()) {
            // Include safe file aliases, but never follow directory links
            // (cycles and paths outside the selected workspace).
            try {
              const target = await AppStorage.assertInWorkspace(path);
              if ((await fs.stat(target)).isFile()) files.push(path);
            } catch {
              /* Broken/outside-workspace aliases are not referenceable. */
            }
          }
          if (files.length >= WORKSPACE_LISTING_LIMITS.files) {
            truncated = true;
            break scan;
          }
        }
      } catch (error) {
        checkWorkspace();
        if (directory === displayRoot) throw error;
        // A subfolder may disappear or become unreadable during the walk.
      }
    }
    checkWorkspace();
    return { paths: files.sort(), truncated };
  }

  /** Offer only directories selected by a native picker or trusted restore. */
  static offerWorkspaceRoot(root: string, restoring = false): boolean {
    if (typeof root !== 'string' || !root) return false;
    try {
      const canonical = realpathSync.native(resolve(root));
      if (!statSync(canonical).isDirectory()) return false;
      if (restoring) AppStorage.restoringWorkspaceRoot = canonical;
      else AppStorage.offeredWorkspaceRoot = canonical;
      return true;
    } catch {
      return false;
    }
  }

  /** Renderer acknowledgement cannot grant access to arbitrary directories. */
  static adoptWorkspaceRoot(root: unknown): boolean {
    if (root === null) {
      AppStorage.setWorkspaceRoot(null);
      return true;
    }
    if (typeof root !== 'string' || !root) return false;
    try {
      const canonical = realpathSync.native(resolve(root));
      if (
        canonical !== AppStorage.workspaceRoot &&
        canonical !== AppStorage.offeredWorkspaceRoot &&
        canonical !== AppStorage.restoringWorkspaceRoot
      )
        return false;
      if (!statSync(canonical).isDirectory()) return false;
      AppStorage.setWorkspaceRoot(canonical);
      return true;
    } catch {
      return false;
    }
  }

  /** Keep unapproved renderer roots out of the next launch's trusted restore. */
  static getSessionWorkspaceRoot(requested: unknown): string | null {
    const selected =
      AppStorage.workspaceRoot ?? AppStorage.restoringWorkspaceRoot;
    if (!selected) return null;
    if (typeof requested === 'string' && requested) {
      try {
        // Preserve a selected symlink's display path when it still refers
        // to the same authorised directory.
        if (realpathSync.native(resolve(requested)) === selected)
          return requested;
      } catch {
        /* Retain the authorised root when a renderer path is stale. */
      }
    }
    return selected;
  }

  private static canReadWorkspaceDirectory(canonical: string): boolean {
    if (
      canonical === AppStorage.offeredWorkspaceRoot ||
      canonical === AppStorage.restoringWorkspaceRoot
    )
      return true;
    const root = AppStorage.workspaceRoot;
    if (!root) return false;
    const rel = relative(root, canonical);
    return (
      rel === '' ||
      (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
    );
  }

  /**
   * Set (or clear) the current workspace root. Main normalises with
   * `path.resolve` so trailing slashes / mixed separators are equivalent,
   * then canonicalises via `fs.realpathSync.native` so an opened symlinked folder
   * matches the canonical paths derived from `fs.realpath(target)`.
   *
   * Native resolution also expands Windows 8.3 aliases consistently with
   * `fs.promises.realpath`. The legacy sync API can preserve those aliases.
   * It falls back to the lexical `resolve(root)` if the
   * directory can't be canonicalised (was just deleted, permission
   * denied, etc.), `assertInWorkspace` then surfaces the real error
   * the next time the user fs-ops against the workspace.
   */
  static setWorkspaceRoot(root: string | null): void {
    AppStorage.offeredWorkspaceRoot = null;
    AppStorage.restoringWorkspaceRoot = null;
    if (!root) {
      AppStorage.workspaceRoot = null;
      return;
    }
    const absolute = resolve(root);
    try {
      AppStorage.workspaceRoot = realpathSync.native(absolute);
    } catch {
      AppStorage.workspaceRoot = absolute;
    }
  }

  /**
   * Throw if `target` is outside the open workspace (or no workspace
   * is open). Returns the resolved (canonicalised, symlink-followed)
   * absolute path when the check passes. Callers must use the returned
   * path rather than the original renderer-supplied alias.
   *
   * Pass `mustExist: false` for write/create paths whose target may
   * not exist yet. Existing targets are canonicalised too; for a missing
   * target we resolve the nearest existing ancestor before appending
   * missing segments. This catches symlinks above missing directories.
   */
  static async assertInWorkspace(
    target: string,
    opts: { mustExist?: boolean } = { mustExist: true },
  ): Promise<string> {
    const root = AppStorage.workspaceRoot;
    if (!root) {
      throw new Error(
        'No workspace is open. Open a folder before reading or writing files.',
      );
    }
    if (!target || typeof target !== 'string') {
      throw new Error('Invalid path');
    }
    let absolute = resolve(target);
    if (opts.mustExist === false) {
      const missing: string[] = [];
      let ancestor = absolute;
      for (;;) {
        try {
          absolute = join(await fs.realpath(ancestor), ...missing);
          break;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
          // A dangling symlink exists but cannot be canonicalised. Never
          // treat it as a missing filename and follow it during a write.
          try {
            await fs.lstat(ancestor);
            throw new Error(`Cannot resolve symbolic link: ${ancestor}`, {
              cause: err,
            });
          } catch (statError) {
            if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw statError;
            }
          }
          const parent = dirname(ancestor);
          if (parent === ancestor) throw err;
          missing.unshift(basename(ancestor));
          ancestor = parent;
        }
      }
    } else {
      try {
        absolute = await fs.realpath(absolute);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          throw new Error(`File not found: ${target}`, { cause: err });
        }
        throw err;
      }
    }
    const rel = relative(root, absolute);
    const isParentTraversal = rel === '..' || rel.startsWith('..' + sep);
    if (rel === '' || isParentTraversal || isAbsolute(rel)) {
      // Empty relative means target === root, which is fine for
      // directory ops but never for read/write of a file.
      if (rel === '' && opts.mustExist !== false) {
        throw new Error(
          `Path is a directory (workspace root), not a file: ${target}`,
        );
      }
      if (isParentTraversal || isAbsolute(rel)) {
        throw new Error(
          `Path is outside the workspace: ${target} (workspace: ${root})`,
        );
      }
    }
    return absolute;
  }

  /**
   * Get the path to the active file
   * @returns - the active file path or null
   */
  static getActiveFilePath() {
    return AppStorage.activeFilePath;
  }

  /**
   * Set the active file.
   *
   * @param context
   * @param file
   * @returns
   */
  static setActiveFile(context: BrowserWindow, file: string | null = null) {
    // Split on both separators so this works on Linux/macOS (`/`) and
    // Windows (`\`). The pre-existing version split only on `\` and
    // shipped the full path as `filename` on POSIX systems.
    const filename = file ? (file.split(/[\\/]/).pop() ?? '') : '';
    const content = file ? readFileSync(file, { encoding: 'utf-8' }) : '';
    if (file) AppStorage.authorizeFile(context, file);

    AppStorage.activeFilePath = file;

    if (file) app.addRecentDocument(file);

    context.webContents.send('from:file:opened', {
      file,
      filename,
      content,
    });

    return {
      filename,
      content,
    };
  }

  /**
   * Open the active file.
   *
   * @param context - the browser window
   * @param file - the file to open
   * @returns
   */
  static openActiveFile(context: BrowserWindow, file: string | null) {
    if (
      context &&
      file &&
      file !== '.' &&
      !file.startsWith('-') &&
      file.indexOf('MKEditor.lnk') === -1
    ) {
      try {
        if (!statSync(file).isFile()) throw new Error('Not a regular file');
        AppStorage.setActiveFile(context, file);
      } catch {
        // Native launch/open events have no awaiting caller to report failures.
        context.webContents.send('from:notification:display', {
          status: 'error',
          key: 'notifications:unable_open_file',
        });
      }
    }
  }

  /**
   * Create a new file.
   *
   * @param context - the browser window
   */
  static async createNewFile(context: BrowserWindow) {
    AppStorage.setActiveFile(context, null);
  }

  /**
   * Save a file.
   *
   * @param context - the browser window
   * @param options - save file options
   * @returns
   */
  static async saveFile(
    context: BrowserWindow,
    options: SaveFileOptions,
  ): Promise<
    | { ok: true; path: string }
    | { ok: false; cancelled?: boolean; error?: string }
  > {
    const isHTMLExport = options.data.startsWith('<!DOCTYPE html>');
    const errorAction = isHTMLExport
      ? 'notifications:unable_export_preview'
      : 'notifications:unable_save_markdown';
    const successAction = isHTMLExport
      ? 'notifications:exported_html_success'
      : 'notifications:saved_markdown_success';
    const config = {
      title: 'Save file',
      defaultPath: isHTMLExport ? `export-0${options.id}` : 'Untitled',
      buttonLabel: 'Save',
      filters: [
        ...(isHTMLExport ? [{ name: 'html', extensions: ['html'] }] : []),
        { name: 'md', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    };

    try {
      let filePath = options.filePath;
      let destination: string | undefined;
      if (filePath) {
        try {
          destination = AppStorage.canonicalSavePath(filePath);
        } catch {
          // Unavailable or new destinations still require a native selection.
        }
      }
      if (!destination || !AppStorage.isSaveAuthorized(context, destination)) {
        const selection = await dialog.showSaveDialog(context, config);
        if (selection.canceled || !selection.filePath) {
          return { ok: false, cancelled: true };
        }
        filePath = selection.filePath;
        destination = AppStorage.canonicalSavePath(filePath);
      }
      if (!filePath || !destination)
        throw new Error('Invalid save destination');
      if (options.excludedPaths?.length) {
        const canonical = (path: string) => {
          let absolute = resolve(path);
          try {
            absolute = realpathSync.native(absolute);
          } catch {
            /* New targets need not exist. */
          }
          return process.platform === 'win32'
            ? absolute.toLowerCase()
            : absolute;
        };
        const destination = canonical(filePath);
        if (
          options.excludedPaths.some((path) => canonical(path) === destination)
        ) {
          throw new Error('Destination is already open in another tab');
        }
      }
      await AppStorage.writeTextFile(
        destination,
        options.data,
        options.encoding ?? 'utf-8',
      );
      AppStorage.authorizeFile(context, destination);
      context.webContents.send('from:notification:display', {
        status: 'success',
        key: successAction,
      });
      if (!isHTMLExport && options.openFile !== false) {
        AppStorage.setActiveFile(context, filePath);
      }
      return { ok: true, path: filePath };
    } catch (err) {
      context.webContents.send('from:notification:display', {
        status: 'error',
        key: errorAction,
      });
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Save a file to PDF.
   *
   * @param context - the browser window
   * @param offscreen - the offscreen render window for the PDF
   * @param options - save file options
   * @returns
   */
  static async saveFileToPDF(
    context: BrowserWindow,
    offscreen: BrowserWindow,
    options: SaveFileOptions,
  ) {
    try {
      const defaultPath = `pdf-export-${options.id}`;
      offscreen.setTitle(defaultPath);
      await offscreen.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(options.data)}`,
      );
      await offscreen.webContents.executeJavaScript(`
        (async () => {
          await document.fonts?.ready;
          const images = Array.from(document.images).map(img =>
            img.complete ? Promise.resolve() :
            new Promise(res => { img.onload = img.onerror = () => res(); })
          );
          await Promise.all(images);
        })();
      `);
      const pdf = await offscreen.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
      });
      const { canceled, filePath } = await dialog.showSaveDialog(context, {
        filters: [{ name: defaultPath, extensions: ['pdf'] }],
        defaultPath: `${defaultPath}.pdf`,
      });
      if (canceled || !filePath) return;
      await fs.writeFile(filePath, pdf);
      context.webContents.send('from:notification:display', {
        status: 'success',
        key: 'notifications:exported_pdf_success',
      });
    } catch {
      context.webContents.send('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_export_preview',
      });
    } finally {
      if (!offscreen.isDestroyed()) offscreen.destroy();
    }
  }

  /**
   * Show the open file dialog.
   *
   * @param context - the browser window
   * @returns
   */
  static async showOpenDialog(context: BrowserWindow) {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        filters: [
          { name: 'Text Files', extensions: ['html', 'md', 'txt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });
      if (canceled || filePaths.length === 0) return null;
      const file = AppStorage.setActiveFile(context, filePaths[0]);
      return { file: filePaths[0], ...file };
    } catch {
      context.webContents.send('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_open_file',
      });
      return null;
    }
  }

  /**
   * Open a folder/directory path.
   *
   * @param context - the browser window
   * @param filePath - the filepath
   * @returns
   */
  static async openPath(context: BrowserWindow, filePath: string) {
    try {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('invalidpath');
      }

      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        const canonical = await fs.realpath(filePath);
        if (!AppStorage.canReadWorkspaceDirectory(canonical)) {
          throw new Error('Directory has not been selected as a workspace');
        }
        const tree = await AppStorage.readDirectory(filePath);
        context.webContents.send('from:folder:opened', {
          path: filePath,
          tree,
        });
      } else if (stats.isFile()) {
        const canonical = await fs.realpath(filePath);
        if (!AppStorage.isSaveAuthorized(context, canonical)) {
          await AppStorage.assertInWorkspace(filePath);
        }
        AppStorage.setActiveFile(context, filePath);
      } else {
        throw new Error('unsupported');
      }
    } catch (err) {
      const code = (err as any)?.code || (err as Error).message;
      const key =
        code == 'ENOENT' || code == 'invalidpath'
          ? 'notifications:path_not_exist'
          : code == 'EACCES' || code == 'EPERM'
            ? 'notifications:permission_denied_open_path'
            : 'notifications:unable_open_path';

      context.webContents.send('from:notification:display', {
        status: 'error',
        key,
      });
    }
  }

  /**
   * Open a directory.
   *
   * @param context - the browser window
   * @returns
   */
  static async openDirectory(context: BrowserWindow) {
    try {
      const { filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory'],
      });

      if (filePaths.length === 0) {
        throw new Error('noselection');
      }

      const tree = await AppStorage.readDirectory(filePaths[0]);
      if (!AppStorage.offerWorkspaceRoot(filePaths[0])) {
        throw new Error('Selected directory is unavailable');
      }
      context.webContents.send('from:folder:opened', {
        path: filePaths[0],
        tree,
        workspaceChange: true,
      });
      return tree;
    } catch (err) {
      if ((err as Error).message !== 'noselection') {
        context.webContents.send('from:notification:display', {
          status: 'error',
          key: 'notifications:unable_open_folder',
        });
      }
    }
  }

  /**
   * Create a new empty file in the given directory.
   *
   * @param context - the browser window
   * @param parent - parent directory path
   * @param name - name of the new file
   */
  /**
   * Create a new file at `parent/name` with `content` and open it
   * as the active tab. Returns `{ok: true, path}` on success or
   * `{ok: false, error}` on failure so callers can react honestly —
   * the menu-driven flow surfaces a toast based on the result, and
   * the AI assistant's `create_file` tool reports the error back to
   * the agent instead of pretending the write succeeded. Parent
   * directories are auto-created.
   */
  static async createFile(
    context: BrowserWindow,
    parent: string,
    name: string,
    content = '',
  ): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    try {
      const file = join(parent, name);
      // mkdir -p the parent so creating `poems/spring.md` succeeds
      // even when `poems/` doesn't exist yet — both the menu-driven
      // "new file" flow and the AI assistant's `create_file` tool
      // route through here. fs.mkdir with `recursive: true` is a
      // no-op when the directory already exists.
      await fs.mkdir(dirname(file), { recursive: true });
      // New-file actions must never truncate an existing document.
      await fs.writeFile(file, content, { encoding: 'utf-8', flag: 'wx' });
      const tree = await AppStorage.readDirectory(parent);
      context.webContents.send('from:folder:opened', { path: parent, tree });
      // Open the newly-written file as a tab. Inlined here (instead of
      // a separate `to:file:openpath` round-trip from the renderer)
      // because the renderer-side `openPath` previously raced
      // `fs.writeFile` and surfaced a spurious "Unable to open path"
      // toast when stat ran before the write finished.
      AppStorage.setActiveFile(context, file);
      return { ok: true, path: file };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /**
   * Write a pasted-image's bytes to disk inside the workspace and
   * return the absolute path. The renderer's paste handler then
   * inserts a `![](relative-path)` markdown link at the cursor.
   *
   * `directory` may be:
   *   - relative (e.g. `./assets`) — resolved against `dirname(sourceFile)`
   *   - absolute — used as-is, but the workspace-containment check
   *     below still applies, so paths outside the workspace are
   *     rejected
   *
   * Filename: `Pasted image YYYYMMDDHHMMSS.<ext>`, with `(2)`/`(3)`/…
   * counter suffixes when same-second pastes collide.
   *
   * Stage complete bytes before exclusive publication so a crash mid-write doesn't
   * leave a half-written image referenced by the freshly-inserted
   * markdown link.
   */
  static async writePastedImage(
    context: BrowserWindow,
    sourceFile: string,
    directory: string,
    bytes: Uint8Array,
    extension: string,
  ): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    try {
      const guard = AppStorage.workspaceMutationGuard();
      // Resolve `directory` against the source file's folder when it
      // looks relative; treat absolute paths as-is.
      const sourceDir = dirname(sourceFile);
      const targetDir = isAbsolute(directory)
        ? resolve(directory)
        : resolve(sourceDir, directory);

      // Workspace scope check — mkdir / write must stay inside the
      // open workspace. `mustExist: false` because the target dir
      // may not exist yet (we'll create it next).
      const safeTargetDir = await AppStorage.assertInWorkspace(targetDir, {
        mustExist: false,
      });
      const anchorPath = join(safeTargetDir, '.mkeditor-guard');
      guard.capture(anchorPath);
      guard.createParents(anchorPath);

      const safeExt = AppStorage.normalizeImageExtension(extension);
      const baseName = AppStorage.buildPastedImageBasename(new Date());
      const tmpPath = join(
        safeTargetDir,
        `.mkeditor-image-${randomUUID()}.tmp`,
      );
      let finalPath: string;
      try {
        await guard.writeNew(tmpPath, bytes);
        const finalName = AppStorage.allocatePastedImageName(
          safeTargetDir,
          baseName,
          safeExt,
          tmpPath,
          guard,
        );
        finalPath = join(safeTargetDir, finalName);
      } finally {
        try {
          if (guard.inspect(tmpPath)) unlinkSync(tmpPath);
        } catch {
          // A replaced parent must never redirect temporary-file cleanup.
        }
      }

      guard.inspect(finalPath);
      // Refresh the file-tree row for the target directory so the
      // newly-written image surfaces in the sidebar.
      try {
        const tree = await AppStorage.readDirectory(safeTargetDir);
        context.webContents.send('from:folder:opened', {
          path: safeTargetDir,
          tree,
        });
      } catch {
        // Non-fatal: the file is on disk; the user can refresh the
        // tree manually if this listing read fails.
      }

      guard.inspect(finalPath);
      return { ok: true, path: finalPath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /**
   * Clamp `extension` to a known image format. Anything else is
   * coerced to `png` — the most common clipboard format and the
   * format Chromium screenshots default to.
   */
  private static normalizeImageExtension(extension: string): string {
    const lowered = extension.replace(/^\.+/, '').toLowerCase();
    const allowed = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);
    return allowed.has(lowered) ? lowered : 'png';
  }

  /**
   * `img_20260521143015` — second-resolution timestamp, sortable,
   * no spaces.
   */
  private static buildPastedImageBasename(now: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `img_${now.getFullYear()}${pad(now.getMonth() + 1)}` +
      `${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}` +
      `${pad(now.getSeconds())}`
    );
  }

  /**
   * Return the first non-colliding filename for `baseName.<ext>` in
   * `directory`. If `baseName.<ext>` exists, tries `baseName_2.<ext>`,
   * then `_3`, … up to a sane cap. The cap exists so a broken
   * filesystem can't spin this forever.
   */
  private static allocatePastedImageName(
    directory: string,
    baseName: string,
    extension: string,
    tmpPath: string,
    guard: WorkspaceMutationGuard,
  ): string {
    const candidate = (n: number) =>
      n === 1 ? `${baseName}.${extension}` : `${baseName}_${n}.${extension}`;
    for (let n = 1; n <= 1000; n++) {
      const name = candidate(n);
      try {
        // Publish complete bytes exclusively. Access followed by rename
        // allowed simultaneous pastes to overwrite each other's images.
        try {
          guard.inspect(tmpPath);
          guard.parent(join(directory, name));
          linkSync(tmpPath, join(directory, name));
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(code ?? ''))
            throw error;
          // Removable filesystems may lack hard links. An exclusive copy
          // still protects existing documents from overwrite.
          guard.inspect(tmpPath);
          guard.parent(join(directory, name));
          copyFileSync(
            tmpPath,
            join(directory, name),
            fsConstants.COPYFILE_EXCL,
          );
        }
        return name;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new Error('Unable to allocate a unique pasted-image filename');
  }

  /**
   * Create a new folder in the given directory.
   */
  /**
   * Create a new folder at `parent/name`. Returns `{ok: true, path}`
   * on success or `{ok: false, error}` on failure so callers can
   * react honestly — the menu-driven flow surfaces a toast based on
   * the result, and the AI assistant's `create_folder` tool reports
   * the error back to the agent. `mkdir -p` so missing intermediate
   * directories are created automatically.
   */
  static async createFolder(
    context: BrowserWindow,
    parent: string,
    name: string,
  ): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    try {
      const dir = join(parent, name);
      await fs.mkdir(dir, { recursive: true });
      const tree = await AppStorage.readDirectory(parent);
      context.webContents.send('from:folder:opened', { path: parent, tree });
      return { ok: true, path: dir };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /**
   * Rename a file or folder.
   */
  static async renamePath(context: BrowserWindow, path: string, name: string) {
    const parent = dirname(path);
    try {
      if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
        throw new Error('Invalid file name');
      }
      const newPath = join(parent, name);
      if (newPath === path) return;
      const source = realpathSync.native(path);
      const destination = AppStorage.canonicalSavePath(newPath);
      try {
        await fs.lstat(newPath);
        const caseOnlySelf =
          newPath.toLowerCase() === path.toLowerCase() &&
          (await fs.realpath(newPath)) === (await fs.realpath(path));
        if (!caseOnlySelf) throw new Error('Destination already exists');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await fs.rename(path, newPath);
      AppStorage.moveFileAuthorization(context, source, destination);
      const tree = await AppStorage.readDirectory(parent);
      context.webContents.send('from:folder:opened', { path: parent, tree });
      context.webContents.send('from:path:renamed', {
        oldPath: path,
        newPath,
        name,
      });
      context.webContents.send('from:notification:display', {
        status: 'success',
        key: 'notifications:renamed_success',
      });
    } catch {
      context.webContents.send('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_rename',
      });
    }
  }

  /**
   * Move a file or folder to a new location inside the workspace.
   * Returns a structured result so the renderer can branch on
   * success / failure for toasts and UI state (drag-and-drop drop
   * handler, "Move to…" modal). The fire-and-forget shape `rename`
   * uses doesn't fit drag-drop — the source row needs to know
   * whether to clear its "dragging" styling on failure.
   *
   * Guards:
   *   - Both `srcPath` and the eventual `dstPath` must sit inside
   *     the open workspace (same containment check the other write
   *     tools use).
   *   - `srcPath` must exist.
   *   - `dstPath` must NOT exist (collisions refuse — surface the
   *     conflict instead of overwriting silently).
   *   - The destination's parent directory must exist. We don't
   *     auto-create directories for moves; a typo'd target path
   *     would otherwise silently spawn an unwanted folder tree.
   *   - For directory moves, `dstPath` must not be inside `srcPath`
   *     (refuses `mv /a/b /a/b/sub` and self-into-self).
   *
   * Writes:
   *   - Uses an atomic rename on-volume. On EXDEV, copies without
   *     deleting the source and returns cross_device_conflict. A portable
   *     copy/check/delete cannot exclude an edit before source removal.
   *
   * Effects:
   *   - Emits `from:folder:opened` for BOTH the source-parent and
   *     dest-parent directories so the file tree updates both
   *     ends.
   *   - Emits `from:path:renamed` so `FileManager` updates the
   *     path keys of any open tabs backed by the moved file (or
   *     by descendants of a moved folder).
   */
  static async moveItem(
    context: BrowserWindow,
    srcPath: string,
    dstPath: string,
  ): Promise<
    | { ok: true; oldPath: string; newPath: string }
    | { ok: false; error: string }
  > {
    try {
      const guard = AppStorage.workspaceMutationGuard();
      const safeSrc = await AppStorage.assertInWorkspace(srcPath, {
        mustExist: true,
      });
      guard.capture(safeSrc);
      const safeDst = await AppStorage.assertInWorkspace(dstPath, {
        mustExist: false,
      });
      guard.capture(safeDst);

      // Refuse no-op moves so we don't emit churn for nothing.
      if (safeSrc === safeDst) {
        return { ok: false, error: 'destination_same_as_source' };
      }

      // Refuse moving a directory into itself or any of its
      // descendants. Comparison is on canonical paths with a
      // trailing separator so `/a/b` doesn't falsely flag `/a/bc`
      // as a descendant.
      const srcWithSep = safeSrc.endsWith(sep) ? safeSrc : safeSrc + sep;
      if (safeDst === safeSrc || safeDst.startsWith(srcWithSep)) {
        return { ok: false, error: 'destination_inside_source' };
      }

      // The destination's parent must exist. assertInWorkspace's
      // `mustExist: false` mode already canonicalises the parent,
      // but doesn't fail if it doesn't exist — verify explicitly
      // here so we don't accidentally spawn a deep tree on a typo.
      const dstParent = dirname(safeDst);
      try {
        const parentStat = await fs.stat(dstParent);
        if (!parentStat.isDirectory()) {
          return { ok: false, error: 'destination_parent_not_directory' };
        }
      } catch {
        return { ok: false, error: 'destination_parent_missing' };
      }

      // Refuse collisions — surface the conflict rather than
      // overwriting silently. `fs.access` resolves when the path
      // exists, throws ENOENT when it doesn't.
      try {
        await fs.lstat(safeDst);
        return { ok: false, error: 'destination_exists' };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }

      // A cross-volume copy has no atomic unchanged-source deletion. Retain
      // both locations rather than deleting edits made during or after copying.
      try {
        guard.rename(safeSrc, safeDst);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EXDEV') throw err;
        await guard.copy(safeSrc, safeDst);
        await AppStorage.refreshMoveParents(context, safeSrc, safeDst);
        return { ok: false, error: 'cross_device_conflict' };
      }

      AppStorage.moveFileAuthorization(context, safeSrc, safeDst);

      // Refresh both ends of the move. Source-parent loses the
      // entry; dest-parent gains it.
      await AppStorage.refreshMoveParents(context, safeSrc, safeDst);

      // Update any open tabs backed by the moved file (or by
      // descendants of a moved folder). FileManager already
      // handles this channel — see the rename path. We pass the
      // basename so the tab label is updated to match.
      context.webContents.send('from:path:renamed', {
        oldPath: safeSrc,
        newPath: safeDst,
        name: basename(safeDst),
      });

      return { ok: true, oldPath: safeSrc, newPath: safeDst };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  private static async refreshMoveParents(
    context: BrowserWindow,
    source: string,
    destination: string,
  ): Promise<void> {
    for (const path of new Set([dirname(source), dirname(destination)])) {
      try {
        const tree = await AppStorage.readDirectory(path);
        context.webContents.send('from:folder:opened', { path, tree });
      } catch {
        // Keep the mutation result even if an explorer refresh fails.
      }
    }
  }

  /**
   * Delete a file or folder.
   */
  static async deletePath(context: BrowserWindow, path: string) {
    const parent = dirname(path);
    try {
      await fs.rm(path, { recursive: true, force: true });
      context.webContents.send('from:path:deleted', { path });
      const tree = await AppStorage.readDirectory(parent);
      context.webContents.send('from:folder:opened', { path: parent, tree });
      context.webContents.send('from:notification:display', {
        status: 'success',
        key: 'notifications:deleted_success',
      });
    } catch {
      context.webContents.send('from:notification:display', {
        status: 'error',
        key: 'notifications:unable_delete',
      });
    }
  }

  /**
   * Get properties of a file or folder.
   */
  static async getPathProperties(path: string) {
    const stats = await fs.stat(path);
    let size: string;
    if (stats.size >= 1024 * 1024) {
      size = `${(stats.size / (1024 * 1024)).toFixed(2)} MB`;
    } else {
      size = `${(stats.size / 1024).toFixed(2)} KB`;
    }

    return {
      path,
      isDirectory: stats.isDirectory(),
      size,
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
    };
  }

  /**
   * Read directory contents.
   *
   * Surfaces directories plus the curated set of workspace-relevant
   * file types (see `WORKSPACE_EXTENSIONS_DOTTED` in
   * `src/app/shared/fileExtensions.ts` — the single source of truth
   * shared with `WebFileBridge.listChildren` and the React funnel UI).
   *
   * @param dir - the directory to read
   * @returns - the directory contents
   */
  static async readDirectory(dir: string): Promise<any[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const filtered = entries.filter((d) => {
      if (d.isDirectory()) return true;
      const dot = d.name.lastIndexOf('.');
      if (dot < 0) return false;
      return WORKSPACE_EXTENSIONS_DOTTED.has(d.name.slice(dot).toLowerCase());
    });
    return Promise.all(
      filtered.map(async (entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          return {
            type: 'directory',
            name: entry.name,
            path: full,
            hasChildren: true,
          };
        }

        return { type: 'file', name: entry.name, path: full };
      }),
    );
  }
}
