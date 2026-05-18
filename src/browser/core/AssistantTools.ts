import type { BridgeManager } from './BridgeManager';
import type { ToolDescriptor } from '../../app/interfaces/Assistant';

/**
 * Tool class — read-class tools auto-execute, write-class tools
 * require user confirmation (unless the conversation has
 * `autoAcceptWrites` set).
 */
export type ToolClass = 'read' | 'write' | 'unknown';

/**
 * Preview payload shown in `<ConfirmToolCall>` for write-class tools.
 * Built by the executor before the dialog opens so the dialog itself
 * stays stateless about file system / editor state.
 */
export interface ToolConfirmPreview {
  kind: 'edit' | 'write' | 'create' | 'replace' | 'insert';
  path?: string;
  /** Text being replaced (undefined for `create` and `insert`). */
  before?: string;
  /** Text the tool will write. */
  after: string;
  /** Optional descriptive line (e.g. line range for `edit`). */
  detail?: string;
}

/**
 * The contract `AssistantManager` consumes. `AssistantTools`
 * implements it; the two communicate through this interface so
 * AssistantManager doesn't take a direct dependency on the
 * filesystem-touching catalog.
 */
export interface ToolExecutor {
  /** Returns true when the named tool is in the catalog. */
  hasTool(name: string): boolean;
  /** Returns descriptors ready for shipping to the SDK via `ChatRequest.tools`. */
  describe(): ToolDescriptor[];
  /** Returns 'read' (auto-execute) / 'write' (confirm) / 'unknown'. */
  classify(name: string): ToolClass;
  /** Build the confirm-dialog preview for write-class tools. */
  buildPreview(name: string, args: unknown): ToolConfirmPreview | null;
  /** Execute a tool. Throws on internal failure. */
  execute(name: string, args: unknown): Promise<unknown>;
}

/* -------------------------------------------------------------------- */
/*  Internal tool registry                                                */
/* -------------------------------------------------------------------- */

interface ToolSpec {
  description: string;
  parameters: object; // JSON Schema
  toolClass: ToolClass;
  execute(args: unknown, ctx: ToolContext): Promise<unknown>;
  preview?(args: unknown, ctx: ToolContext): ToolConfirmPreview;
}

/** Cross-cutting deps each tool needs. */
interface ToolContext {
  bridge: BridgeManager;
}

const PREVIEW_TRUNCATE_AT = 4000;

function truncate(text: string): string {
  if (text.length <= PREVIEW_TRUNCATE_AT) return text;
  return text.slice(0, PREVIEW_TRUNCATE_AT) + '\n\n…[truncated]';
}

/** Wait for a path to land in FileManager.models (idempotent if already there). */
function waitForFileToOpen(
  bridge: BridgeManager,
  path: string,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (bridge.fileManager.models.has(path)) {
      resolve();
      return;
    }
    const off = bridge.fileManager.on('change', () => {
      if (bridge.fileManager.models.has(path)) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
    const timer = setTimeout(() => {
      off();
      const root =
        bridge.fileTreeManager.getSnapshot().treeRoot ?? '<no workspace>';
      reject(
        new Error(
          `Timed out waiting for ${path} to open. Workspace root: ${root}. The file may not exist or may have failed to load — call list_files() to see what's available.`,
        ),
      );
    }, timeoutMs);
  });
}

/**
 * Wait for a directory's children to land in the file tree snapshot.
 * The file tree is lazy-loaded — directories appear as
 * `{ type: 'directory', hasChildren: true, loaded: false }` until the
 * user expands them (or until something explicitly requests their
 * contents). For agent-driven listings we have to request the load
 * ourselves and wait for the change event before walking deeper.
 */
function waitForDirectoryLoad(
  bridge: BridgeManager,
  path: string,
  timeoutMs = 3000,
): Promise<void> {
  const ftm = bridge.fileTreeManager;
  type Node = {
    type: 'file' | 'directory';
    path: string;
    loaded?: boolean;
    children?: Node[];
  };
  const findNode = (nodes: Node[]): Node | undefined => {
    for (const n of nodes) {
      if (n.path === path) return n;
      if (n.type === 'directory' && n.children) {
        const hit = findNode(n.children);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  const isLoaded = (): boolean => {
    const node = findNode(ftm.getSnapshot().nodes as Node[]);
    return node?.type === 'directory' && node.loaded === true;
  };
  return new Promise((resolve, reject) => {
    if (isLoaded()) return resolve();
    const off = ftm.on('change', () => {
      if (isLoaded()) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
    const timer = setTimeout(() => {
      off();
      reject(new Error(`Timed out waiting for directory ${path} to load`));
    }, timeoutMs);
    ftm.requestDirectoryContents(path);
  });
}

/** True for `C:\...` / `C:/...` (Windows) or `/...` (POSIX). */
function isAbsolutePath(p: string): boolean {
  return /^([A-Za-z]:[\\/]|\/)/.test(p);
}

/**
 * Resolve a user-supplied path to an absolute one, using the open
 * workspace as a reference. Necessary because:
 *
 *   - `FileManager.models` keys are always absolute (main resolves them
 *     before emitting `from:file:opened`). If we ship a relative path
 *     to `to:file:openpath`, `fs.stat` resolves against the main
 *     process's CWD (the launch directory), not the workspace —
 *     usually the wrong directory, so the open silently fails and we
 *     time out waiting for the wrong key.
 *
 *   - The agent often constructs a path from intuition (e.g. it adds
 *     the workspace's own basename as a prefix) and would otherwise
 *     get an opaque timeout. Searching the file tree by suffix /
 *     basename catches the common slip-ups and resolves to the right
 *     absolute path; if nothing matches we throw with the workspace
 *     root in the message so the agent can correct itself.
 *
 * Strategy:
 *   1. Absolute path → pass-through.
 *   2. Relative + workspace open:
 *      a. Search tree for files whose absolute path ends with `path`.
 *      b. Fall back to basename-only match if (a) finds nothing.
 *      c. Single match → use it. Multiple → throw with the candidates.
 *      d. No match in the tree → naively join against treeRoot and let
 *         `to:file:openpath` decide (the file may exist outside the
 *         markdown-filtered tree).
 *   3. Relative + no workspace → throw immediately.
 */
function resolveWorkspacePath(ctx: ToolContext, path: string): string {
  if (isAbsolutePath(path)) return path;
  const snap = ctx.bridge.fileTreeManager.getSnapshot();
  if (!snap.treeRoot) {
    throw new Error(
      `Path "${path}" is relative but no workspace folder is open. Use an absolute path.`,
    );
  }
  const slashed = path.replace(/[\\/]/g, '/').replace(/^\.\//, '');
  const basename = slashed.split('/').pop() ?? slashed;
  const exact: string[] = [];
  const byBasename: string[] = [];
  const walk = (nodes: { path: string; type: 'file' | 'directory'; children?: unknown[] }[]): void => {
    for (const n of nodes) {
      if (n.type === 'file') {
        const norm = n.path.replace(/\\/g, '/');
        if (norm === slashed || norm.endsWith('/' + slashed)) {
          exact.push(n.path);
        } else if (norm.endsWith('/' + basename) || norm === basename) {
          byBasename.push(n.path);
        }
      }
      if (n.type === 'directory' && n.children) {
        walk(n.children as Parameters<typeof walk>[0]);
      }
    }
  };
  walk(snap.nodes as Parameters<typeof walk>[0]);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      `Path "${path}" matched ${exact.length} files: ${exact.slice(0, 5).join(', ')}. Use the absolute path.`,
    );
  }
  if (byBasename.length === 1) return byBasename[0];
  if (byBasename.length > 1) {
    throw new Error(
      `Path "${path}" not found, but ${byBasename.length} files share its basename: ${byBasename.slice(0, 5).join(', ')}. Use an absolute path or include enough directory context.`,
    );
  }
  // Nothing in the tree — fall back to a naive join. The tree is
  // markdown-filtered, so non-md files won't appear; we still want
  // `to:file:openpath` to get a chance.
  return joinUnderRoot(snap.treeRoot, path);
}

/**
 * Resolve a workspace-relative or absolute subdirectory hint to an
 * absolute directory prefix usable for filtering `list_files`. Same
 * suffix-then-basename matching as `resolveWorkspacePath` but searches
 * directory nodes (not files). When nothing matches, falls back to a
 * naive join under treeRoot so the caller can still pass the prefix to
 * `startsWith` checks — listings will simply come back empty if the
 * directory really doesn't exist.
 */
function resolveSubdirPath(ctx: ToolContext, subpath: string): string {
  if (isAbsolutePath(subpath)) return subpath;
  const snap = ctx.bridge.fileTreeManager.getSnapshot();
  if (!snap.treeRoot) {
    throw new Error(
      `subpath "${subpath}" is relative but no workspace folder is open.`,
    );
  }
  const slashed = subpath
    .replace(/[\\/]/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
  const basename = slashed.split('/').pop() ?? slashed;
  const exact: string[] = [];
  const byBasename: string[] = [];
  type DirNode = {
    type: 'file' | 'directory';
    path: string;
    name?: string;
    children?: DirNode[];
  };
  const walk = (nodes: DirNode[]): void => {
    for (const n of nodes) {
      if (n.type === 'directory') {
        const norm = n.path.replace(/\\/g, '/');
        if (norm === slashed || norm.endsWith('/' + slashed)) {
          exact.push(n.path);
        } else if (norm.endsWith('/' + basename) || norm === basename) {
          byBasename.push(n.path);
        }
        if (n.children) walk(n.children);
      }
    }
  };
  walk(snap.nodes as DirNode[]);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      `subpath "${subpath}" matched ${exact.length} directories: ${exact.slice(0, 5).join(', ')}. Use an absolute path.`,
    );
  }
  if (byBasename.length === 1) return byBasename[0];
  if (byBasename.length > 1) {
    throw new Error(
      `subpath "${subpath}" not found, but ${byBasename.length} directories share its basename: ${byBasename.slice(0, 5).join(', ')}. Use an absolute path or include more parent context.`,
    );
  }
  return joinUnderRoot(snap.treeRoot, subpath);
}

function joinUnderRoot(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  const cleaned = rel
    .replace(/[\\/]/g, sep)
    .replace(new RegExp(`^${sep === '\\' ? '\\\\' : '/'}+`), '');
  return root.endsWith(sep) ? root + cleaned : root + sep + cleaned;
}

/**
 * The catalog. Each entry's `parameters` is a plain JSON Schema dict
 * — the SDK accepts these directly via the `jsonSchema()` wrapper on
 * the main side. We hand-write them rather than going through Zod so
 * the tool registry stays small and dependency-free (Zod is already
 * in the project but only used in P1's main-process AppAssistant).
 */
const CATALOG: Record<string, ToolSpec> = {
  // ---- READ-class -------------------------------------------------

  read_file: {
    description:
      'Read the full text content of a file in the workspace. Does NOT open a tab — reads directly from disk (or from the open buffer if you happen to have it open already, so unsaved edits are captured). Use freely for context-gathering. Prefer absolute paths or paths returned verbatim from list_files; relative paths are resolved against the workspace root.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Absolute path (e.g. C:\\foo\\bar.md or /Users/foo/bar.md) — preferred. Workspace-relative paths are also accepted and resolved via the file tree.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    toolClass: 'read',
    async execute(args, ctx) {
      const { path: input } = args as { path: string };
      const path = resolveWorkspacePath(ctx, input);
      const fm = ctx.bridge.fileManager;
      // Fast path: file is already open as a tab. Read from the live
      // Monaco model so any unsaved edits the user has typed are
      // included — and we avoid an unnecessary disk hit.
      const openModel = fm.models.get(path);
      if (openModel) {
        return {
          path,
          content: openModel.getValue(),
          lineCount: openModel.getLineCount(),
        };
      }
      // File not open. Read directly from disk via the mked invoke
      // helper — this is what keeps tab-spam down: every read used to
      // pop a new tab, which gets noisy fast when the agent is
      // gathering context across many files.
      const mked = window.mked;
      if (!mked?.readFile) {
        throw new Error(
          'read_file: main-process bridge unavailable (web mode); reading files is desktop-only for now.',
        );
      }
      try {
        const { content, lineCount } = await mked.readFile(path);
        return { path, content, lineCount };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`read_file: failed to read ${path}: ${message}`, {
          cause: err,
        });
      }
    },
  },

  list_files: {
    description:
      'List markdown files visible in the workspace file tree. Lazy-loaded subdirectories are loaded on demand. Returns up to 500 paths.',
    parameters: {
      type: 'object',
      properties: {
        subpath: {
          type: 'string',
          description:
            'Optional subdirectory to restrict the listing (workspace-relative or absolute). Omit for the full workspace.',
        },
      },
      additionalProperties: false,
    },
    toolClass: 'read',
    async execute(args, ctx) {
      const { subpath } = (args ?? {}) as { subpath?: string };
      const ftm = ctx.bridge.fileTreeManager;
      if (!ftm.getSnapshot().treeRoot) {
        return { root: null, paths: [] };
      }

      // Resolve subpath to an absolute directory prefix. Search the
      // tree for a directory node whose absolute path ends with the
      // requested suffix (mirrors resolveWorkspacePath's logic but for
      // directories, not files). Multiple matches → throw with
      // candidates; no matches → naive join under treeRoot.
      let scope: string | null = null;
      if (subpath) {
        scope = resolveSubdirPath(ctx, subpath);
      }

      // BFS-style walk that loads unloaded directories as it descends.
      // Cap MAX_LOADS so a pathological workspace can't stall the
      // agent. Cap MAX_FILES so the response stays bounded.
      const MAX_FILES = 500;
      const MAX_LOADS = 100;
      let loadCount = 0;
      const paths: string[] = [];

      type Node = {
        type: 'file' | 'directory';
        path: string;
        hasChildren?: boolean;
        loaded?: boolean;
        children?: Node[];
      };

      const inScope = (p: string): boolean => !scope || p.startsWith(scope);
      // True if walking into this directory could still reach the scope
      // (either the dir is inside the scope, or the scope is inside it).
      const couldReachScope = (p: string): boolean =>
        !scope || p.startsWith(scope) || scope.startsWith(p);

      const visit = async (nodes: Node[]): Promise<void> => {
        for (const n of nodes) {
          if (paths.length >= MAX_FILES) return;
          if (!couldReachScope(n.path)) continue;
          if (n.type === 'file') {
            if (inScope(n.path)) paths.push(n.path);
            continue;
          }
          // Directory: ensure children are loaded before recursing.
          let dir = n;
          if (dir.hasChildren && !dir.loaded && loadCount < MAX_LOADS) {
            loadCount += 1;
            try {
              await waitForDirectoryLoad(ctx.bridge, dir.path);
            } catch {
              continue; // load failed/timed out — skip this branch
            }
            // The snapshot has been mutated under our feet — re-find
            // the (now-loaded) node so we walk its fresh children.
            dir = (findNode(
              ftm.getSnapshot().nodes as Node[],
              dir.path,
            ) ?? dir) as Node;
          }
          if (dir.children) await visit(dir.children);
        }
      };

      const findNode = (nodes: Node[], target: string): Node | undefined => {
        for (const n of nodes) {
          if (n.path === target) return n;
          if (n.type === 'directory' && n.children) {
            const hit = findNode(n.children, target);
            if (hit) return hit;
          }
        }
        return undefined;
      };

      await visit(ftm.getSnapshot().nodes as Node[]);

      return {
        root: scope ?? ftm.getSnapshot().treeRoot,
        paths,
        truncated: paths.length >= MAX_FILES,
      };
    },
  },

  get_active_file: {
    description:
      'Return the path and full content of the currently-active tab. Returns null when no file is open.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    toolClass: 'read',
    async execute(_args, ctx) {
      const fm = ctx.bridge.fileManager;
      const path = fm.activeFile;
      if (!path) return { path: null };
      const model = fm.models.get(path);
      if (!model) return { path };
      return {
        path,
        content: model.getValue(),
        lineCount: model.getLineCount(),
      };
    },
  },

  get_selection: {
    description:
      'Return the currently-selected text in the active editor + its line/column range. Empty selection returns an empty string.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    toolClass: 'read',
    async execute(_args, ctx) {
      const editor = ctx.bridge.mkeditor;
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (!selection || !model) return { text: '', range: null };
      const text = model.getValueInRange(selection);
      return {
        text,
        range: {
          startLine: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLine: selection.endLineNumber,
          endColumn: selection.endColumn,
        },
      };
    },
  },

  open_tab: {
    description:
      'Open a workspace file as a new tab (or focus it if already open). Absolute paths preferred; relative paths resolve against the workspace root.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to open.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    toolClass: 'read',
    async execute(args, ctx) {
      const { path: input } = args as { path: string };
      const path = resolveWorkspacePath(ctx, input);
      ctx.bridge.bridge.send('to:file:openpath', { path });
      return { ok: true, path };
    },
  },

  // ---- WRITE-class ------------------------------------------------

  write_file: {
    description:
      'Replace the full content of a file. Opens the file as the active tab if not already open. Prompts the user for confirmation by default.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    toolClass: 'write',
    preview(args, ctx) {
      const { path: input, content } = args as { path: string; content: string };
      // Best-effort resolution for the preview: if it throws (e.g. no
      // workspace) fall through to showing the path the agent sent.
      let path = input;
      try {
        path = resolveWorkspacePath(ctx, input);
      } catch {
        /* preview is non-fatal */
      }
      const existing = ctx.bridge.fileManager.models.get(path);
      return {
        kind: 'write',
        path,
        before: existing ? truncate(existing.getValue()) : undefined,
        after: truncate(content),
      };
    },
    async execute(args, ctx) {
      const { path: input, content } = args as { path: string; content: string };
      const path = resolveWorkspacePath(ctx, input);
      const fm = ctx.bridge.fileManager;
      if (!fm.models.has(path)) {
        ctx.bridge.bridge.send('to:file:openpath', { path });
        await waitForFileToOpen(ctx.bridge, path);
      }
      const model = fm.models.get(path);
      if (model) model.setValue(content);
      ctx.bridge.bridge.send('to:file:save', {
        content,
        file: path,
        prompt: false,
      });
      return { ok: true, path };
    },
  },

  edit_file: {
    description:
      'Replace a specific substring inside a file. `oldText` is the exact text to find — it MUST appear exactly once in the file (include enough surrounding context to be unique). `newText` replaces it verbatim. Prompts for confirmation by default. Use this for targeted edits; use `write_file` for whole-file rewrites.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldText: {
          type: 'string',
          description:
            'Exact text to replace. Must appear exactly once in the file. Include surrounding lines if needed for uniqueness. Line endings are normalised — write \\n; the editor reconciles to the file\'s own line endings.',
        },
        newText: {
          type: 'string',
          description: 'Text that replaces oldText verbatim.',
        },
      },
      required: ['path', 'oldText', 'newText'],
      additionalProperties: false,
    },
    toolClass: 'write',
    preview(args, ctx) {
      const { path: input, oldText, newText } = args as {
        path: string;
        oldText: string;
        newText: string;
      };
      // Best-effort resolution for the preview path; if it throws we
      // still show the user the diff with the path they supplied.
      let path = input;
      try {
        path = resolveWorkspacePath(ctx, input);
      } catch {
        /* preview is non-fatal */
      }
      // Preview shows the literal text being replaced (oldText), so
      // the dialog can never disagree with what `execute` actually
      // does — they both anchor on the same substring.
      return {
        kind: 'edit',
        path,
        before: truncate(oldText),
        after: truncate(newText),
      };
    },
    async execute(args, ctx) {
      const { path: input, oldText, newText } = args as {
        path: string;
        oldText: string;
        newText: string;
      };
      if (!oldText) throw new Error('oldText must not be empty');
      const path = resolveWorkspacePath(ctx, input);
      const fm = ctx.bridge.fileManager;
      if (!fm.models.has(path)) {
        ctx.bridge.bridge.send('to:file:openpath', { path });
        await waitForFileToOpen(ctx.bridge, path);
      }
      const model = fm.models.get(path);
      if (!model) throw new Error(`Couldn't open ${path}`);
      // Activate the file so executeEdits has a focused editor; the
      // edit applies to the model directly which is enough, but
      // activating gives the user immediate visual feedback.
      fm.activateFile(path);
      // Normalise the search text to the model's EOL so a `\n`-only
      // oldText matches a CRLF file (and vice versa).
      const eol = model.getEOL();
      const needle =
        eol === '\r\n'
          ? oldText.replace(/\r?\n/g, '\r\n')
          : oldText.replace(/\r\n/g, '\n');
      // We do a plain `indexOf` on the model's text instead of
      // `model.findMatches(...)` because Monaco's non-regex searcher
      // is line-bounded — it won't match a substring that spans
      // newlines, even with EOL-normalised input. `getPositionAt`
      // converts a raw character offset back to a Monaco Position
      // (which understands the model's EOL), so the resulting range
      // is identical to what Monaco itself would compute.
      const haystack = model.getValue();
      const firstIdx = haystack.indexOf(needle);
      if (firstIdx < 0) {
        throw new Error(
          `edit_file: oldText not found in ${path}. The text must appear verbatim (whitespace and punctuation matter). Pass enough surrounding context to be unique.`,
        );
      }
      const secondIdx = haystack.indexOf(needle, firstIdx + needle.length);
      if (secondIdx >= 0) {
        throw new Error(
          `edit_file: oldText matched multiple places in ${path}. Include more surrounding context so the match is unique.`,
        );
      }
      const startPos = model.getPositionAt(firstIdx);
      const endPos = model.getPositionAt(firstIdx + needle.length);
      ctx.bridge.mkeditor.executeEdits('assistant-tool-edit_file', [
        {
          range: {
            startLineNumber: startPos.lineNumber,
            startColumn: startPos.column,
            endLineNumber: endPos.lineNumber,
            endColumn: endPos.column,
          },
          text: newText,
          forceMoveMarkers: true,
        },
      ]);
      ctx.bridge.bridge.send('to:file:save', {
        content: model.getValue(),
        file: path,
        prompt: false,
      });
      return { ok: true, path };
    },
  },

  create_file: {
    description:
      'Create a new file at `path` with the given content. Prompts for confirmation by default.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'New file path. Use forward slashes; main resolves it under the workspace.',
        },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    toolClass: 'write',
    preview(args, ctx) {
      const { path: input, content } = args as { path: string; content: string };
      let path = input;
      try {
        path = resolveWorkspacePath(ctx, input);
      } catch {
        /* preview is non-fatal */
      }
      return {
        kind: 'create',
        path,
        after: truncate(content),
      };
    },
    async execute(args, ctx) {
      const { path: input, content } = args as { path: string; content: string };
      // resolveWorkspacePath will fall through to a naive join under
      // treeRoot since the destination doesn't exist in the tree yet.
      const path = resolveWorkspacePath(ctx, input);
      // Split into parent directory + file name for the existing
      // `to:file:create` channel. The channel accepts an optional
      // `content` field (added so this tool can write initial content
      // atomically — `to:file:save` refuses to write to a path that
      // doesn't exist yet, and an extra round-trip via openpath +
      // setValue + save would race main's fs.writeFile completion).
      const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      const parent = lastSlash > 0 ? path.slice(0, lastSlash) : '';
      const name = lastSlash > 0 ? path.slice(lastSlash + 1) : path;
      ctx.bridge.bridge.send('to:file:create', { parent, name, content });
      // Open the new file as a tab so the user sees it. Fire-and-
      // forget — failure to land isn't fatal (the file is already on
      // disk with the right content). We don't await landing in
      // models because `to:file:create` doesn't fire `from:file:opened`
      // and `to:file:openpath` is racy against the create.
      ctx.bridge.bridge.send('to:file:openpath', { path });
      return { ok: true, path };
    },
  },

  replace_selection: {
    description:
      'Replace the currently-selected text in the active editor with new content. Prompts for confirmation by default.',
    parameters: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content'],
      additionalProperties: false,
    },
    toolClass: 'write',
    preview(args, ctx) {
      const { content } = args as { content: string };
      const editor = ctx.bridge.mkeditor;
      const selection = editor.getSelection();
      const model = editor.getModel();
      const before =
        selection && model ? model.getValueInRange(selection) : '';
      return {
        kind: 'replace',
        path: ctx.bridge.fileManager.activeFile ?? undefined,
        before: truncate(before),
        after: truncate(content),
      };
    },
    async execute(args, ctx) {
      const { content } = args as { content: string };
      const editor = ctx.bridge.mkeditor;
      const selection = editor.getSelection();
      if (!selection) throw new Error('No selection to replace');
      editor.executeEdits('assistant-tool-replace_selection', [
        {
          range: selection,
          text: content,
          forceMoveMarkers: true,
        },
      ]);
      const path = ctx.bridge.fileManager.activeFile;
      if (path && !path.startsWith('untitled-')) {
        ctx.bridge.bridge.send('to:file:save', {
          content: editor.getValue(),
          file: path,
          prompt: false,
        });
      }
      return { ok: true };
    },
  },

  insert_at_cursor: {
    description:
      'Insert text at the current cursor position in the active editor (no replacement). Prompts for confirmation by default.',
    parameters: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content'],
      additionalProperties: false,
    },
    toolClass: 'write',
    preview(args, ctx) {
      const { content } = args as { content: string };
      return {
        kind: 'insert',
        path: ctx.bridge.fileManager.activeFile ?? undefined,
        after: truncate(content),
      };
    },
    async execute(args, ctx) {
      const { content } = args as { content: string };
      const editor = ctx.bridge.mkeditor;
      const position = editor.getPosition();
      if (!position) throw new Error('No cursor position');
      editor.executeEdits('assistant-tool-insert_at_cursor', [
        {
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
          text: content,
          forceMoveMarkers: true,
        },
      ]);
      const path = ctx.bridge.fileManager.activeFile;
      if (path && !path.startsWith('untitled-')) {
        ctx.bridge.bridge.send('to:file:save', {
          content: editor.getValue(),
          file: path,
          prompt: false,
        });
      }
      return { ok: true };
    },
  },
};

/* -------------------------------------------------------------------- */
/*  AssistantTools                                                        */
/* -------------------------------------------------------------------- */

/**
 * Implements `ToolExecutor`. Wraps the static `CATALOG` with the
 * cross-cutting context (the BridgeManager ref). Constructed by
 * `BridgeManager` after the other managers exist and handed to
 * `AssistantManager.setToolExecutor`.
 *
 * Why an instance class rather than a plain `executeTool(name, args)`
 * function: BridgeManager needs to outlive the renderer-side reload
 * cycle, and the instance shape leaves room for per-tool state (e.g.
 * caching workspace listings) that P8 polish may introduce.
 */
export class AssistantTools implements ToolExecutor {
  private readonly ctx: ToolContext;

  constructor(bridge: BridgeManager) {
    this.ctx = { bridge };
  }

  hasTool(name: string): boolean {
    return name in CATALOG;
  }

  describe(): ToolDescriptor[] {
    return Object.entries(CATALOG).map(([name, spec]) => ({
      name,
      description: spec.description,
      parameters: spec.parameters,
    }));
  }

  classify(name: string): ToolClass {
    return CATALOG[name]?.toolClass ?? 'unknown';
  }

  buildPreview(name: string, args: unknown): ToolConfirmPreview | null {
    const spec = CATALOG[name];
    if (!spec || !spec.preview) return null;
    try {
      return spec.preview(args, this.ctx);
    } catch {
      // Preview is best-effort; if it fails (e.g. model not yet open)
      // skip the preview and let the dialog show just the args.
      return null;
    }
  }

  async execute(name: string, args: unknown): Promise<unknown> {
    const spec = CATALOG[name];
    if (!spec) throw new UnknownToolError(name);
    return spec.execute(args, this.ctx);
  }
}

export class UnknownToolError extends Error {
  constructor(public toolName: string) {
    super(`Unknown tool: ${toolName}`);
    this.name = 'UnknownToolError';
  }
}
