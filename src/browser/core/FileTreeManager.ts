import type { ContextBridgeAPI } from '../interfaces/Bridge';

/**
 * A plain data node in the file explorer tree. Mirrors what main process
 * sends over the bridge in `from:folder:opened` plus a `loaded` flag for
 * lazy directory loading.
 */
export interface TreeNode {
  type: 'file' | 'directory';
  name: string;
  path: string;
  /** Directory only — true if there are children to lazy-load. */
  hasChildren?: boolean;
  /** Directory only — true once main has populated `children`. */
  loaded?: boolean;
  /** Directory only — populated after lazy load. */
  children?: TreeNode[];
}

export interface FileTreeSnapshot {
  treeRoot: string | null;
  nodes: TreeNode[];
}

const EMPTY_SNAPSHOT: FileTreeSnapshot = { treeRoot: null, nodes: [] };

/**
 * Handle the file explorer tree.
 *
 * Keeps `treeRoot`, builds and mutates a `TreeNode[]` snapshot, and
 * exposes an observable surface (`on('change')` + `getSnapshot()`)
 * for `<FileTreePanel>` to subscribe via `useSyncExternalStore`.
 */
export class FileTreeManager {
  /** Root path for the current file tree (null if no folder open). */
  public treeRoot: string | null = null;

  /** Flag to indicate a new root folder is being opened */
  public openingFolder = false;

  /** Index of directory nodes by path for fast lazy-load targeting. */
  private directoryIndex: Map<string, TreeNode> = new Map();

  /** Stable snapshot used by FileTreeContext. */
  private snapshot: FileTreeSnapshot = EMPTY_SNAPSHOT;

  /** Change listeners. */
  private listeners = new Set<() => void>();

  /**
   * Create a new file tree manager instance.
   *
   * @param bridge - the execution bridge
   * @param openFileFromPath - callback to open a file (delegates to FileManager)
   */
  constructor(
    private bridge: ContextBridgeAPI,
    private openFileFromPath: (path: string) => void,
  ) {}

  // ---------------------------------------------------------------------
  // Observable surface
  // ---------------------------------------------------------------------

  public on(event: 'change', listener: () => void): () => void {
    if (event !== 'change') {
      throw new Error(`FileTreeManager.on: unsupported event "${event}"`);
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): FileTreeSnapshot {
    return this.snapshot;
  }

  private emitChange() {
    // Recreate the snapshot reference so useSyncExternalStore sees a
    // changed identity. Inner node identities are preserved where
    // possible so React reconciliation is stable.
    this.snapshot = {
      treeRoot: this.treeRoot,
      nodes: this.snapshot.nodes,
    };
    this.listeners.forEach((l) => l());
  }

  // ---------------------------------------------------------------------
  // Tree construction (data-only)
  // ---------------------------------------------------------------------

  /**
   * Build (or replace) a portion of the file explorer tree. Called from
   * `BridgeListeners.from:folder:opened` with the directory listing
   * shipped by main.
   *
   * @param tree - validated TreeNode[] from main
   * @param parentPath - the directory being populated (equal to `treeRoot`
   *   for the initial root load, or a subdirectory for lazy loads)
   */
  public buildFileTree(tree: unknown[], parentPath: string) {
    const validated = validateNodes(tree);
    const sorted = sortNodes(validated);

    if (!this.treeRoot || parentPath === this.treeRoot) {
      // Root populate (or replace). Reset the directory index.
      this.treeRoot = parentPath;
      this.directoryIndex = new Map();
      const rooted = sorted.map((node) =>
        this.registerNode(this.cloneNode(node)),
      );
      this.snapshot = { treeRoot: this.treeRoot, nodes: rooted };
      this.listeners.forEach((l) => l());
      return;
    }

    const target = this.directoryIndex.get(parentPath);
    if (!target) {
      // The target doesn't exist in the tree yet — e.g. main just
      // wrote a file inside `workspace/poems/poems/`, sent the
      // listing for that new subfolder, but `workspace/poems/poems`
      // isn't in our index because nothing has ever expanded the
      // parent. Walk up to the nearest known ancestor (or the
      // root, which is always known) and ask main to repopulate
      // that subtree — the missing intermediate directory will
      // appear in the refreshed listing.
      if (parentPath.startsWith(this.treeRoot)) {
        const ancestor = this.findKnownAncestor(parentPath);
        if (ancestor) this.requestDirectoryContents(ancestor);
      }
      return;
    }

    // Lazy-load completed: replace children, mark loaded, and emit. If
    // the directory turned out empty, flip hasChildren=false so the
    // chevron disappears.
    target.children = sorted.map((node) =>
      this.registerNode(this.cloneNode(node)),
    );
    target.loaded = true;
    if (target.children.length === 0) target.hasChildren = false;
    this.emitChange();
  }

  /**
   * Walk up from `path` toward `treeRoot` and return the first
   * ancestor that's either in the directory index or equal to the
   * root. Returns null only when `path` is outside the workspace.
   */
  private findKnownAncestor(path: string): string | null {
    if (!this.treeRoot || !path.startsWith(this.treeRoot)) return null;
    const sep = this.treeRoot.includes('\\') ? '\\' : '/';
    let current = path;
    // Strip one segment at a time. Bounded by the root check
    // below — `treeRoot` is always considered known.
    while (current.length > this.treeRoot.length) {
      const lastSep = current.lastIndexOf(sep);
      if (lastSep < this.treeRoot.length) break;
      current = current.slice(0, lastSep);
      if (current === this.treeRoot || this.directoryIndex.has(current)) {
        return current;
      }
    }
    return this.treeRoot;
  }

  /**
   * Insert a single file node under its parent directory in the existing
   * tree. Called when `from:file:opened` carries a real file path inside
   * the current root.
   */
  public addFileToTree(path: string) {
    if (!this.treeRoot || !path.startsWith(this.treeRoot)) return;

    const sep = this.treeRoot.includes('\\') ? '\\' : '/';
    const segments = path.split(/[/\\]/);
    const rootSegments = this.treeRoot.split(/[/\\]/);
    const rel = segments.slice(rootSegments.length);
    const fileName = rel[rel.length - 1];

    // Walk down to the parent directory's children array.
    let currentPath = this.treeRoot;
    let children: TreeNode[] | undefined = this.snapshot.nodes;
    for (let i = 0; i < rel.length - 1; i++) {
      currentPath += sep + rel[i];
      const dir = this.directoryIndex.get(currentPath);
      if (!dir) {
        // The intermediate directory hasn't been loaded yet — same
        // failure mode `buildFileTree` guards against. Walk up to
        // the nearest known ancestor and ask main to repopulate
        // it so the missing intermediate directory + the new file
        // both become visible after the refresh.
        const ancestor = this.findKnownAncestor(path);
        if (ancestor) this.requestDirectoryContents(ancestor);
        return;
      }
      if (!dir.children) dir.children = [];
      children = dir.children;
    }
    if (!children) return;

    // Idempotency: don't double-insert.
    if (children.some((n) => n.type === 'file' && n.path === path)) return;

    const node: TreeNode = { type: 'file', name: fileName, path };

    // Insert preserving directory-first / alpha-name ordering.
    const insertAt = findInsertIndex(children, node);
    children.splice(insertAt, 0, node);

    this.emitChange();
  }

  // ---------------------------------------------------------------------
  // Bridge-side actions called by the React tree
  // ---------------------------------------------------------------------

  /**
   * Request the contents of a directory from main. The reply arrives as
   * `from:folder:opened` and routes back through `buildFileTree`.
   */
  public requestDirectoryContents(path: string) {
    this.bridge.send('to:file:openpath', { path });
  }

  /** Forward a file open to FileManager (used by tree clicks). */
  public openFile(path: string) {
    this.openFileFromPath(path);
  }

  /**
   * Reset the tree state — empties the snapshot, clears the directory
   * index, and emits change so `<FileTreePanel>` falls back to the
   * empty-state UI. Used by the web "Disconnect folder" action.
   */
  public clearTree(): void {
    this.treeRoot = null;
    this.openingFolder = false;
    this.directoryIndex = new Map();
    this.snapshot = { treeRoot: null, nodes: [] };
    this.listeners.forEach((l) => l());
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private cloneNode(node: TreeNode): TreeNode {
    return {
      type: node.type,
      name: node.name,
      path: node.path,
      hasChildren: node.hasChildren,
      loaded: node.loaded,
      children: node.children,
    };
  }

  private registerNode(node: TreeNode): TreeNode {
    if (node.type === 'directory') {
      this.directoryIndex.set(node.path, node);
    }
    return node;
  }
}

// -----------------------------------------------------------------------
// Pure helpers (no this binding so they're trivially testable)
// -----------------------------------------------------------------------

function validateNodes(tree: unknown[]): TreeNode[] {
  if (!Array.isArray(tree)) return [];
  return tree.filter((n): n is TreeNode => {
    if (typeof n !== 'object' || n === null) return false;
    const candidate = n as Partial<TreeNode>;
    return (
      (candidate.type === 'directory' || candidate.type === 'file') &&
      typeof candidate.name === 'string' &&
      typeof candidate.path === 'string'
    );
  });
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    }
    return a.type === 'directory' ? -1 : 1;
  });
}

function findInsertIndex(children: TreeNode[], node: TreeNode): number {
  // Directories first, then files. Within each group, alpha by name.
  for (let i = 0; i < children.length; i++) {
    const existing = children[i];
    if (node.type === 'directory' && existing.type === 'file') return i;
    if (node.type === 'file' && existing.type === 'directory') continue;
    if (existing.type === node.type) {
      if (
        node.name.localeCompare(existing.name, undefined, {
          sensitivity: 'base',
        }) < 0
      ) {
        return i;
      }
    }
  }
  return children.length;
}
