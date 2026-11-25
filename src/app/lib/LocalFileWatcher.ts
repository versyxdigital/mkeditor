import { watch, promises as fs, type FSWatcher, type BigIntStats } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import type {
  LocalFilesChanged,
  LocalWatchRequest,
} from '../interfaces/LocalFiles';
import { WORKSPACE_EXTENSIONS_DOTTED } from '../shared/fileExtensions';
import { remapLocalPath } from '../shared/remapLocalPath';

export const LOCAL_WATCH_LIMITS = {
  directories: 256,
  files: 512,
  entries: 20000,
} as const;

export interface LocalFileIdentity {
  dev: string;
  ino: string;
  birthtimeNs: string;
  directory: boolean;
  nlink: number;
}

interface WatchedPath {
  path: string;
  identity: LocalFileIdentity | null;
  followLink?: boolean;
}

interface WatchOptions {
  workspaceRoot(): string | null;
  canWatchFile(path: string): boolean;
  fileIdentity?(path: string): LocalFileIdentity | undefined;
  rename(
    source: string,
    destination: string,
    identity: LocalFileIdentity,
  ): boolean;
  missing(path: string): void;
  changed(change: LocalFilesChanged): void;
}

function within(path: string, root: string): boolean {
  const rel = relative(root, path);
  return (
    rel === '' ||
    (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
  );
}

export function localFileIdentity(stat: BigIntStats): LocalFileIdentity {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
    directory: stat.isDirectory(),
    nlink: Number(stat.nlink),
  };
}

export function sameLocalFile(
  a: LocalFileIdentity,
  b: LocalFileIdentity,
): boolean {
  return (
    a.ino !== '0' &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.birthtimeNs === b.birthtimeNs &&
    a.directory === b.directory
  );
}

/** Native events are hints. Reconcile real identities before changing tab paths. */
export class LocalFileWatcher {
  private root: string | null = null;
  private directories = new Map<string, WatchedPath>();
  private files = new Map<string, WatchedPath>();
  private handles = new Map<
    string,
    { watcher: FSWatcher; recursive: boolean }
  >();
  private observedDirectories = new Set<string>();
  private observedFiles = new Set<string>();
  private listings = new Map<string, string>();
  private timer?: ReturnType<typeof setTimeout>;
  private queue = Promise.resolve();
  private disposed = false;
  private mutations = 0;
  private revision = 0;
  private pendingRefresh?: Promise<void>;
  private refreshAgain = false;
  private limitReported = false;

  constructor(private options: WatchOptions) {}

  update(input: LocalWatchRequest): Promise<void> {
    if (
      !input ||
      !Array.isArray(input.directories) ||
      !Array.isArray(input.files)
    )
      return Promise.resolve();
    return this.enqueue(async () => {
      const root = this.options.workspaceRoot();
      let displayRoot: string | null = null;
      if (root && typeof input.root === 'string') {
        try {
          if ((await fs.realpath(input.root)) === root)
            displayRoot = input.root;
        } catch (error) {
          if (
            ['ENOENT', 'ENOTDIR'].includes(
              (error as NodeJS.ErrnoException).code ?? '',
            ) &&
            relative(resolve(input.root), root) === ''
          )
            displayRoot = input.root;
          /* A missing root is reconciled against its previous identity. */
        }
      }
      if (this.root && input.root === this.root && !displayRoot && root)
        displayRoot = this.root;
      if (this.root !== displayRoot) {
        this.directories.clear();
        this.listings.clear();
        this.root = displayRoot;
        this.limitReported = false;
        this.revision++;
      }
      const wantedFiles = new Set(
        input.files
          .slice(0, LOCAL_WATCH_LIMITS.files)
          .filter(
            (path): path is string =>
              typeof path === 'string' &&
              isAbsolute(path) &&
              this.options.canWatchFile(path),
          ),
      );
      for (const path of this.files.keys())
        if (!wantedFiles.has(path)) {
          this.options.missing(path);
          this.files.delete(path);
        }
      for (const path of wantedFiles) {
        if (!this.files.has(path))
          this.files.set(path, {
            path,
            identity:
              this.options.fileIdentity?.(path) ??
              (await this.initialIdentity(path)),
            followLink: true,
          });
      }
      const wantedDirectories = new Set<string>();
      if (displayRoot) wantedDirectories.add(displayRoot);
      for (const path of input.directories.slice(
        0,
        LOCAL_WATCH_LIMITS.directories,
      )) {
        if (
          typeof path !== 'string' ||
          !displayRoot ||
          !within(path, displayRoot)
        )
          continue;
        try {
          const canonical = await fs.realpath(path);
          if (root && within(canonical, root)) wantedDirectories.add(path);
        } catch {
          /* Retain existing missing paths until reconciliation. */
        }
      }
      for (const path of wantedFiles) {
        let parent = dirname(path);
        while (
          displayRoot &&
          within(parent, displayRoot) &&
          wantedDirectories.size < LOCAL_WATCH_LIMITS.directories
        ) {
          wantedDirectories.add(parent);
          if (parent === displayRoot) break;
          parent = dirname(parent);
        }
      }
      for (const path of [...this.directories.keys()]) {
        if (!wantedDirectories.has(path)) {
          this.directories.delete(path);
          this.listings.delete(path);
        }
      }
      for (const path of [...wantedDirectories].slice(
        0,
        LOCAL_WATCH_LIMITS.directories,
      )) {
        if (!this.directories.has(path))
          this.directories.set(path, {
            path,
            identity: await this.initialIdentity(path),
            followLink: true,
          });
      }
      this.arm();
      if (
        !this.limitReported &&
        (input.files.length > LOCAL_WATCH_LIMITS.files ||
          input.directories.length >= LOCAL_WATCH_LIMITS.directories ||
          wantedDirectories.size > LOCAL_WATCH_LIMITS.directories)
      ) {
        this.limitReported = true;
        this.options.changed({
          root: this.root,
          renames: [],
          missing: [],
          directories: [],
          truncated: true,
        });
      }
      this.schedule();
    });
  }

  /** Do not interpret intermediate states of MKEditor's own mutations. */
  invalidate(): void {
    this.revision++;
    this.schedule();
  }

  async duringMutation<T>(operation: () => T | Promise<T>): Promise<T> {
    this.revision++;
    this.mutations++;
    try {
      return await operation();
    } finally {
      this.mutations--;
      this.schedule();
    }
  }

  refresh(): Promise<void> {
    this.refreshAgain = true;
    if (this.pendingRefresh) return this.pendingRefresh;
    const pending = this.enqueue(async () => {
      this.refreshAgain = false;
      await this.reconcile();
    });
    this.pendingRefresh = pending;
    void pending
      .finally(() => {
        this.pendingRefresh = undefined;
        if (this.refreshAgain) this.schedule();
      })
      .catch(() => {});
    return pending;
  }

  dispose(): void {
    this.disposed = true;
    this.revision++;
    if (this.timer) clearTimeout(this.timer);
    this.handles.forEach((handle) => handle.watcher.close());
    this.handles.clear();
    this.files.clear();
    this.directories.clear();
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(async () => {
      if (!this.disposed) await operation();
    });
    this.queue = next.catch(() => {});
    return next;
  }

  private schedule(): void {
    if (this.disposed || this.timer || this.mutations) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh().catch(() => {});
    }, 200);
    this.timer.unref?.();
  }

  private arm(): void {
    const key = (path: string) =>
      process.platform === 'win32'
        ? resolve(path).toLowerCase()
        : resolve(path);
    this.observedDirectories = new Set([...this.directories.keys()].map(key));
    this.observedFiles = new Set([...this.files.keys()].map(key));
    const parents = new Map<string, boolean>();
    if (process.platform === 'win32') {
      // Separate descendant directory handles prevent Windows from renaming
      // their ancestors. ReadDirectoryChangesW can watch a subtree with one
      // handle; filter its events to loaded folders and known open files.
      const candidates = [
        ...new Set([
          ...(this.root ? [this.root] : []),
          ...[...this.files.keys()].map(dirname),
        ]),
      ].sort((a, b) => a.length - b.length);
      for (const path of candidates) {
        if (![...parents.keys()].some((parent) => within(path, parent)))
          parents.set(path, true);
      }
      if (
        this.root &&
        ![...parents.keys()].some((parent) =>
          within(dirname(this.root!), parent),
        )
      )
        parents.set(dirname(this.root), false);
    } else {
      for (const path of [
        ...this.directories.keys(),
        ...[...this.files.keys()].map(dirname),
      ])
        parents.set(path, false);
      if (this.root) parents.set(dirname(this.root), false);
    }
    for (const [path, handle] of this.handles) {
      if (!parents.has(path) || parents.get(path) !== handle.recursive) {
        handle.watcher.close();
        this.handles.delete(path);
      }
    }
    for (const [path, recursive] of parents) {
      if (this.handles.has(path)) continue;
      try {
        const handle = watch(
          path,
          { persistent: false, recursive },
          (_event, filename) => {
            if (recursive && filename) {
              const changed = join(path, filename.toString());
              if (
                !this.observedFiles.has(key(changed)) &&
                !this.observedDirectories.has(key(changed)) &&
                !this.observedDirectories.has(key(dirname(changed)))
              )
                return;
            }
            this.schedule();
          },
        );
        handle.on('error', () => {
          handle.close();
          if (this.handles.get(path)?.watcher === handle)
            this.handles.delete(path);
        });
        this.handles.set(path, { watcher: handle, recursive });
      } catch {
        /* Focus reconciliation also repairs unavailable native watches. */
      }
    }
  }

  private async initialIdentity(
    path: string,
  ): Promise<LocalFileIdentity | null> {
    try {
      return await this.inspect(path, true);
    } catch {
      return null;
    }
  }

  private async inspect(
    path: string,
    followLink = false,
  ): Promise<LocalFileIdentity | null> {
    try {
      const stat = followLink
        ? await fs.stat(path, { bigint: true })
        : await fs.lstat(path, { bigint: true });
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        return null;
      return localFileIdentity(stat);
    } catch (error) {
      if (
        ['ENOENT', 'ENOTDIR'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        return null;
      throw error;
    }
  }

  private async reconcile(): Promise<void> {
    if (this.mutations || this.disposed) return;
    const revision = this.revision;
    const trustedRoot = this.options.workspaceRoot();
    const batch: LocalFilesChanged = {
      root: this.root,
      renames: [],
      missing: [],
      directories: [],
      truncated: false,
    };
    let nextRoot = this.root;
    let nextFiles = new Map(this.files);
    let nextDirectories = new Map(this.directories);
    const nextListings = new Map(this.listings);
    const planned: { record: WatchedPath; destination: string }[] = [];
    const missing: WatchedPath[] = [];
    for (const record of [
      ...this.directories.values(),
      ...this.files.values(),
    ]) {
      try {
        const current = await this.inspect(record.path, record.followLink);
        const committed = this.files.has(record.path)
          ? this.options.fileIdentity?.(record.path)
          : undefined;
        if (current && committed && sameLocalFile(committed, current))
          record.identity = committed;
        if (
          !current ||
          (record.identity &&
            record.identity.ino !== '0' &&
            !sameLocalFile(record.identity, current))
        )
          missing.push(record);
        else if (!record.identity) record.identity = current;
        if (current && record.identity && process.platform === 'win32') {
          const canonical = await fs.realpath(record.path);
          if (
            canonical !== record.path &&
            canonical.toLowerCase() === record.path.toLowerCase()
          ) {
            planned.push({ record, destination: canonical });
          }
        }
      } catch {
        /* Permission failures are not deletions. Keep the buffer and watch. */
      }
    }
    // Only scan already watched parents, plus parents of missing entries.
    // Never recursively enumerate a repository or infer a move by filename.
    const search = new Set([
      ...this.directories.keys(),
      ...missing.map((record) => dirname(record.path)),
    ]);
    const candidates: WatchedPath[] = [];
    let entries = 0;
    if (missing.length) {
      outer: for (const directory of search) {
        try {
          const handle = await fs.opendir(directory);
          for await (const entry of handle) {
            if (++entries > LOCAL_WATCH_LIMITS.entries) {
              batch.truncated = true;
              break outer;
            }
            if (
              entry.isSymbolicLink() ||
              (!entry.isDirectory() && !entry.isFile())
            )
              continue;
            if (
              !missing.some(
                (record) => record.identity?.directory === entry.isDirectory(),
              )
            )
              continue;
            const path = join(directory, entry.name);
            try {
              candidates.push({ path, identity: await this.inspect(path) });
            } catch {
              /* Skip inaccessible candidates. */
            }
          }
        } catch {
          /* Missing parents are handled below. */
        }
      }
    }
    for (const record of missing.sort(
      (a, b) => a.path.length - b.path.length,
    )) {
      if (batch.renames.some((change) => within(record.path, change.oldPath)))
        continue;
      const matches =
        record.identity &&
        (record.identity.directory || record.identity.nlink === 1)
          ? candidates.filter(
              (candidate) =>
                candidate.path !== record.path &&
                candidate.identity &&
                (candidate.identity.directory ||
                  candidate.identity.nlink === 1) &&
                sameLocalFile(record.identity!, candidate.identity),
            )
          : [];
      if (matches.length === 1 && !batch.truncated && record.identity) {
        const newPath = matches[0].path;
        planned.push({ record, destination: newPath });
        batch.renames.push({ oldPath: record.path, newPath });
        const remap = (path: string) =>
          within(path, record.path)
            ? remapLocalPath(path, record.path, newPath)
            : path;
        nextFiles = new Map(
          [...nextFiles].map(([path, value]) => [
            remap(path),
            { ...value, path: remap(path) },
          ]),
        );
        nextDirectories = new Map(
          [...nextDirectories].map(([path, value]) => [
            remap(path),
            { ...value, path: remap(path) },
          ]),
        );
        nextListings.clear();
        if (this.root === record.path) {
          nextRoot = newPath;
          batch.newRoot = newPath;
        }
      } else {
        batch.missing.push(record.path);
        if (record.path === this.root) batch.rootMissing = true;
      }
    }
    entries = 0;
    for (const directory of nextDirectories.keys()) {
      try {
        const canonical = await fs.realpath(directory);
        const root =
          nextRoot !== this.root ? nextRoot : this.options.workspaceRoot();
        if (
          !root ||
          !within(canonical, root) ||
          batch.missing.some((path) => within(directory, path))
        )
          continue;
        const tree: LocalFilesChanged['directories'][number]['tree'] = [];
        const handle = await fs.opendir(canonical);
        for await (const entry of handle) {
          if (++entries > LOCAL_WATCH_LIMITS.entries) {
            batch.truncated = true;
            break;
          }
          if (entry.isDirectory())
            tree.push({
              type: 'directory',
              name: entry.name,
              path: join(directory, entry.name),
              hasChildren: true,
            });
          else if (
            (entry.isFile() || entry.isSymbolicLink()) &&
            WORKSPACE_EXTENSIONS_DOTTED.has(
              entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase(),
            )
          )
            tree.push({
              type: 'file',
              name: entry.name,
              path: join(directory, entry.name),
            });
        }
        if (batch.truncated) break;
        tree.sort((a, b) => a.path.localeCompare(b.path));
        const signature = JSON.stringify(tree);
        if (nextListings.get(directory) !== signature) {
          nextListings.set(directory, signature);
          batch.directories.push({ path: directory, tree });
        }
      } catch {
        /* Do not replace an unreadable listing with an empty tree. */
      }
    }
    if (
      this.disposed ||
      this.revision !== revision ||
      this.mutations ||
      this.options.workspaceRoot() !== trustedRoot
    )
      return;
    // Commit only after all asynchronous work. Native mutations, disposal and
    // workspace changes invalidate an in-flight reconciliation above.
    const accepted: LocalFilesChanged['renames'] = [];
    for (const { record, destination } of planned.sort(
      (a, b) => a.record.path.length - b.record.path.length,
    )) {
      if (accepted.some((change) => within(record.path, change.oldPath)))
        continue;
      if (this.options.rename(record.path, destination, record.identity!)) {
        accepted.push({ oldPath: record.path, newPath: destination });
      } else batch.missing.push(record.path);
    }
    if (
      accepted.length === planned.length &&
      !planned.some(
        (change) =>
          change.destination.toLowerCase() === change.record.path.toLowerCase(),
      )
    ) {
      this.files = nextFiles;
      this.directories = nextDirectories;
      this.root = nextRoot;
      this.listings = nextListings;
    } else {
      for (const change of accepted) {
        const remap = (path: string) =>
          within(path, change.oldPath)
            ? remapLocalPath(path, change.oldPath, change.newPath)
            : path;
        this.files = new Map(
          [...this.files].map(([path, record]) => [
            remap(path),
            { ...record, path: remap(path) },
          ]),
        );
        this.directories = new Map(
          [...this.directories].map(([path, record]) => [
            remap(path),
            { ...record, path: remap(path) },
          ]),
        );
        if (this.root === change.oldPath) this.root = change.newPath;
      }
      this.listings.clear();
      batch.directories = [];
      batch.newRoot =
        this.root !== batch.root ? (this.root ?? undefined) : undefined;
    }
    batch.renames = accepted;
    const remap = (path: string) => {
      for (const change of accepted)
        if (within(path, change.oldPath))
          path = remapLocalPath(path, change.oldPath, change.newPath);
      return path;
    };
    batch.directories = batch.directories.map((listing) => ({
      path: remap(listing.path),
      tree: listing.tree.map((node) => ({ ...node, path: remap(node.path) })),
    }));
    batch.rootMissing = Boolean(this.root && batch.missing.includes(this.root));
    if (batch.truncated) {
      batch.truncated = !this.limitReported;
      this.limitReported = true;
    }
    for (const path of batch.missing) this.options.missing(path);
    this.arm();
    if (accepted.length) this.schedule();
    if (
      batch.renames.length ||
      batch.missing.length ||
      batch.directories.length ||
      batch.truncated
    )
      this.options.changed(batch);
  }
}
