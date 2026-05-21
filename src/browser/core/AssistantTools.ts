import type { BridgeManager } from './BridgeManager';
import type {
  ToolConfirmPreview,
  ToolDescriptor,
} from '../../app/interfaces/Assistant';

/**
 * Tool class — read-class tools auto-execute, write-class tools
 * require user confirmation (unless the conversation has
 * `autoAcceptWrites` set).
 */
export type ToolClass = 'read' | 'write' | 'unknown';

// `ToolConfirmPreview` moved to `src/app/interfaces/Assistant.ts` so
// the renderer chat snapshot can carry it without browser-side modules
// flowing through `AssistantChatSnapshot`. Re-exported here for
// backwards compatibility with existing imports from
// `../core/AssistantTools`.
export type { ToolConfirmPreview };

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
  /**
   * Resolve the untruncated content of one side of the preview. Used
   * by the inline diff card's "Show full" expander so the React layer
   * doesn't have to source from disk / models itself. Returns
   * undefined when the side has no meaningful expansion (e.g.
   * `replace_selection`'s before) or when the tool has no full-content
   * support (read-class tools, missing per-tool implementation).
   */
  getFullPreviewContent(
    name: string,
    args: unknown,
    side: 'before' | 'after',
  ): Promise<string | undefined>;
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
  /**
   * Resolve the FULL (untruncated) content for one side of the
   * preview. Powers the inline diff card's "Show full" expander
   * without surfacing `window.mked` to React. Returns `undefined`
   * when the side has no meaningful expansion (e.g.
   * `replace_selection`'s before is the user's editor selection at
   * tool-fire time and there's nothing to refetch). Sources the
   * before content the same way `execute` would (open Monaco model
   * first, then disk read via `mked:fs:readfile`) so the expanded
   * preview agrees with what the tool would actually write.
   */
  getFullContent?(
    args: unknown,
    ctx: ToolContext,
    side: 'before' | 'after',
  ): Promise<string | undefined>;
}

/** Cross-cutting deps each tool needs. */
interface ToolContext {
  bridge: BridgeManager;
}

/**
 * Cap on `ToolConfirmPreview.before` / `after` strings. The inline
 * diff card adds a "show full" expander when content hits this cap;
 * see `useExpandableContent` in the renderer.
 */
export const PREVIEW_TRUNCATE_AT = 4000;

/**
 * Suffix appended to a truncated preview string. Used by
 * `useExpandableContent` (and by tests) to detect that a `before` or
 * `after` was truncated client-side — i.e. that a "show full"
 * affordance is meaningful.
 */
export const PREVIEW_TRUNCATION_MARKER = '\n\n…[truncated]';

function truncate(text: string): string {
  if (text.length <= PREVIEW_TRUNCATE_AT) return text;
  return text.slice(0, PREVIEW_TRUNCATE_AT) + PREVIEW_TRUNCATION_MARKER;
}

/**
 * For `edit_file` previews, surface the change in situ — surround the
 * matched `oldText` with ±`contextLines` lines from the live file so
 * the user sees where the edit lands, not just the search/replace pair.
 *
 * Returns `null` if `oldText` doesn't occur in `fileText` (the agent
 * fired an edit that won't match; the preview falls back to the plain
 * oldText→newText diff and the same `execute` failure surfaces on Accept).
 *
 * When the snippet doesn't cover the whole file, `PREVIEW_TRUNCATION_MARKER`
 * is appended to both sides — the inline diff's "Show full" expander
 * then fetches the entire file via `mked:fs:readfile`.
 */
export interface EditContextSnippet {
  before: string;
  after: string;
  /** Human-readable line range, e.g. "Lines 12–18". */
  detail: string;
  /** True iff the snippet doesn't cover the whole file. */
  truncated: boolean;
}

export function buildEditContextSnippet(
  fileText: string,
  oldText: string,
  newText: string,
  contextLines = 3,
): EditContextSnippet | null {
  if (!oldText) return null;

  // Normalise every input to LF before searching.
  fileText = fileText.replace(/\r\n/g, '\n');
  oldText = oldText.replace(/\r\n/g, '\n');
  newText = newText.replace(/\r\n/g, '\n');

  const idx = fileText.indexOf(oldText);
  if (idx < 0) return null;

  // Mirror execute's uniqueness check.
  const secondIdx = fileText.indexOf(oldText, idx + oldText.length);
  if (secondIdx >= 0) return null;

  // Split for line-based slicing. Source is LF-normalised above so
  // `\n` is sufficient; rejoin on `\n` too (the diff editor doesn't
  // care about line-ending fidelity here — preview is for human eyes).
  const allLines = fileText.split('\n');
  const totalLines = allLines.length;

  // 0-indexed line where the match starts (the line containing the
  // first character of `oldText`).
  const matchStartLine = countLines(fileText, 0, idx);
  // Lines actually covered by `oldText`. If oldText is "line A\nline B",
  // it covers TWO lines (start + 1). If it ends with a trailing
  // newline ("line A\n"), Monaco still considers only one line edited
  // — the trailing `\n` is the EOL of the last line, not a separate
  // line. We strip a single trailing newline before counting so the
  // detail line reports the lines a human would call "edited".
  const trimmedOld = oldText.replace(/\r?\n$/, '');
  const matchSpan = countLines(trimmedOld, 0, trimmedOld.length);
  const matchEndLine = matchStartLine + matchSpan;

  const contextStart = Math.max(0, matchStartLine - contextLines);
  const contextEnd = Math.min(totalLines - 1, matchEndLine + contextLines);

  const snippetLines = allLines.slice(contextStart, contextEnd + 1);
  const before = snippetLines.join('\n');
  // The match is guaranteed to occur exactly once in `fileText`; the
  // sliced snippet contains it once too. Single-shot replace.
  const after = before.replace(oldText, newText);

  const truncated = contextStart > 0 || contextEnd < totalLines - 1;
  // `detail` reports the LINES BEING EDITED — single line if the
  // match is one line, range otherwise. Earlier this reported the
  // SNIPPET range (the ±contextLines window around the match), which
  // was misleading: users read "Lines 7–13" as "the edit touches
  // those 7 lines" when in reality the snippet is mostly context.
  const detail =
    matchStartLine === matchEndLine
      ? `Line ${matchStartLine + 1}`
      : `Lines ${matchStartLine + 1}–${matchEndLine + 1}`;
  return {
    before: truncated ? before + PREVIEW_TRUNCATION_MARKER : before,
    after: truncated ? after + PREVIEW_TRUNCATION_MARKER : after,
    detail,
    truncated,
  };
}

/** Count `\n` and `\r\n` line breaks in `text[start..end]`. */
function countLines(text: string, start: number, end: number): number {
  let count = 0;
  for (let i = start; i < end; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 0x0a) {
      count += 1;
    } else if (ch === 0x0d && text.charCodeAt(i + 1) === 0x0a) {
      count += 1;
      i += 1;
    } else if (ch === 0x0d) {
      count += 1;
    }
  }
  return count;
}

/**
 * Normalise line endings in `text` to match Monaco's EOL setting. The
 * `edit_file` tool's `execute` matches its `oldText` against the model
 * after this normalisation — so a `\n`-only search string still matches
 * a CRLF file. Exposed so the preview-expansion path
 * (`AssistantTools.getFullPreviewContent`) can apply the same
 * normalisation and produce an "after" string that matches what
 * `execute` actually writes.
 */
function normaliseForEol(text: string, eol: string): string {
  return eol === '\r\n'
    ? text.replace(/\r?\n/g, '\r\n')
    : text.replace(/\r\n/g, '\n');
}

/**
 * Read the full content of a file the agent's tool is targeting. The
 * open Monaco model wins over disk so we surface the user's *unsaved*
 * edits — the same hierarchy `AssistantContextSource.readFile` uses
 * for the read-class tool path. Falls back to the `mked:fs:readfile`
 * IPC when the file isn't currently a tab.
 *
 * Throws when the bridge is unavailable (web mode — the AI assistant
 * is desktop-only, so reaching this branch in practice means a
 * misconfigured test) or when the IPC read rejects.
 */
async function readFullFile(ctx: ToolContext, path: string): Promise<string> {
  const model = ctx.bridge.fileManager.models.get(path);
  if (model) return model.getValue();
  const mked = window.mked;
  if (!mked?.readFile) {
    throw new Error(
      'Filesystem bridge unavailable; cannot read full file content.',
    );
  }
  const { content } = await mked.readFile(path);
  return content;
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
  const walk = (
    nodes: { path: string; type: 'file' | 'directory'; children?: unknown[] }[],
  ): void => {
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

/**
 * Resolve a create-time path WITHOUT the fuzzy basename matching
 * `resolveWorkspacePath` does for read paths. For `create_file` /
 * `create_folder` the agent is naming something that doesn't exist
 * yet — falling back to "a file with the same basename in some
 * other folder" is exactly wrong and was the cause of a real bug
 * where `create_file('ollama/introduction.md')` got rewritten to
 * `openai/introduction.md` because that file already existed.
 *
 * Absolute paths pass through. Relative paths join literally under
 * the workspace root. Workspace-scope enforcement still happens in
 * main (`AppStorage.assertInWorkspace`) so a `../escape` attempt
 * gets caught regardless.
 */
function resolveCreatePath(ctx: ToolContext, path: string): string {
  if (isAbsolutePath(path)) return path;
  const snap = ctx.bridge.fileTreeManager.getSnapshot();
  if (!snap.treeRoot) {
    throw new Error(
      `Path "${path}" is relative but no workspace folder is open. Use an absolute path.`,
    );
  }
  return joinUnderRoot(snap.treeRoot, path);
}

function joinUnderRoot(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  const cleaned = rel
    .replace(/[\\/]/g, sep)
    .replace(new RegExp(`^${sep === '\\' ? '\\\\' : '/'}+`), '');
  return root.endsWith(sep) ? root + cleaned : root + sep + cleaned;
}

/**
 * Persist `content` to disk via the `mked:fs:savefile` invoke
 * channel and either return the success result or throw a typed
 * error the agent can act on. Used by `write_file`, `edit_file`,
 * `replace_selection`, `insert_at_cursor` — every write-class tool
 * that previously fire-and-forgot `to:file:save` and lied to the
 * agent about whether the write actually landed.
 *
 * In web mode `window.mked.saveFile` isn't installed; the caller
 * should have already guarded against that via the in-memory
 * editor edit, but we throw here so a misuse surfaces clearly.
 */
async function awaitedSaveFile(path: string, content: string): Promise<void> {
  const mked = window.mked;
  if (!mked?.saveFile) {
    throw new Error(
      'saveFile: main-process bridge unavailable (web mode); writing files is desktop-only.',
    );
  }
  const result = await mked.saveFile(path, content);
  if (!result.ok) {
    throw new Error(`Failed to save ${path}: ${result.error}`);
  }
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
      'Read the full text content of a file in the workspace. Does NOT open a tab — reads directly from disk (or from the open buffer if you happen to have it open already, so unsaved edits are captured). Use freely for context-gathering. Prefer absolute paths or paths returned verbatim from list_files; relative paths are resolved against the workspace root. NOTE: this is for files only. To enumerate a directory, use `list_files` with a `subpath` argument; passing a directory path here will return an error.',
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
      'List the workspace contents. Returns two arrays: `paths` (markdown files) and `directories` (folders). The file tree is markdown-focused by design — only `.md` files and the directories that contain them (anywhere in their subtree) are indexed. Folders with no markdown anywhere beneath them (e.g. `node_modules/`, `dist/`) will NOT appear; do not infer their absence as proof they are missing from the filesystem. Lazy-loaded subdirectories are loaded on demand. Returns up to 500 files and 500 directories.',
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
        return { root: null, paths: [], directories: [] };
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
      const MAX_DIRS = 500;
      const MAX_LOADS = 100;
      let loadCount = 0;
      const paths: string[] = [];
      const directories: string[] = [];

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
          if (paths.length >= MAX_FILES && directories.length >= MAX_DIRS) {
            return;
          }
          if (!couldReachScope(n.path)) continue;
          if (n.type === 'file') {
            if (inScope(n.path) && paths.length < MAX_FILES) {
              paths.push(n.path);
            }
            continue;
          }
          // Record the directory itself (the agent asked for folders
          // too) before recursing into its children.
          if (inScope(n.path) && directories.length < MAX_DIRS) {
            directories.push(n.path);
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
            dir = (findNode(ftm.getSnapshot().nodes as Node[], dir.path) ??
              dir) as Node;
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
        directories,
        truncated: paths.length >= MAX_FILES || directories.length >= MAX_DIRS,
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
      // Resolve through `getActiveEditablePath` so a popped-out diff
      // tab (active path = `diff://...`) doesn't surface as the
      // "current file" — Monaco's actual model is still pointing at
      // the editable file underneath the overlay.
      const path = fm.getActiveEditablePath();
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
      const { path: input, content } = args as {
        path: string;
        content: string;
      };
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
    async getFullContent(args, ctx, side) {
      const { path: input, content } = args as {
        path: string;
        content: string;
      };
      let path = input;
      try {
        path = resolveWorkspacePath(ctx, input);
      } catch {
        /* same fallback as preview() */
      }
      if (side === 'after') return content;
      // before: live model first (catches unsaved edits the user
      // typed while the agent was thinking), then disk fallback.
      // Same hierarchy preview() uses for the truncated `before`.
      return readFullFile(ctx, path);
    },
    async execute(args, ctx) {
      const { path: input, content } = args as {
        path: string;
        content: string;
      };
      const path = resolveWorkspacePath(ctx, input);
      const fm = ctx.bridge.fileManager;
      if (!fm.models.has(path)) {
        ctx.bridge.bridge.send('to:file:openpath', { path });
        await waitForFileToOpen(ctx.bridge, path);
      }
      const model = fm.models.get(path);
      if (model) model.setValue(content);
      // Await the disk write so a failure (read-only fs, permission
      // denied, etc.) surfaces to the agent instead of returning a
      // misleading `ok: true`.
      await awaitedSaveFile(path, content);
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
            "Exact text to replace. Must appear exactly once in the file. Include surrounding lines if needed for uniqueness. Line endings are normalised — write \\n; the editor reconciles to the file's own line endings.",
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
      const {
        path: input,
        oldText,
        newText,
      } = args as {
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
      // When the target file is open in a Monaco model (the common
      // case — the agent has just read it), build a context-bounded
      // preview that shows ±3 lines around the match. The user sees
      // WHERE the edit lands instead of an isolated oldText/newText
      // pair that's easy to mis-evaluate.
      //
      // Falls back to the literal oldText → newText pair when the
      // file isn't open or `oldText` doesn't match (the agent fired
      // an edit that will fail; the same error surfaces on Accept).
      const openModel = ctx.bridge.fileManager.models.get(path);
      if (openModel) {
        const snippet = buildEditContextSnippet(
          openModel.getValue(),
          oldText,
          newText,
        );
        if (snippet) {
          return {
            kind: 'edit',
            path,
            before: snippet.before,
            after: snippet.after,
            detail: snippet.detail,
          };
        }
      }
      return {
        kind: 'edit',
        path,
        before: truncate(oldText),
        after: truncate(newText),
      };
    },
    async getFullContent(args, ctx, side) {
      const {
        path: input,
        oldText,
        newText,
      } = args as {
        path: string;
        oldText: string;
        newText: string;
      };
      let path = input;
      try {
        path = resolveWorkspacePath(ctx, input);
      } catch {
        /* same fallback as preview() */
      }
      // `before` is the full file (live model > disk) — same hierarchy
      // execute() uses (it always operates on the open model). For
      // `after` we additionally apply the EOL-normalised replacement
      // that execute() would actually perform, so the expanded diff
      // mirrors the on-disk result Monaco's executeEdits produces.
      const before = await readFullFile(ctx, path);
      if (side === 'before') return before;
      const model = ctx.bridge.fileManager.models.get(path);
      const eol = model ? model.getEOL() : '\n';
      const needle = normaliseForEol(oldText, eol);
      const replacement = normaliseForEol(newText, eol);
      // If the needle isn't in the file (the agent's edit would fail
      // on Accept), surface the unchanged content so the diff renders
      // honestly — no fake replacement. The Accept path will then
      // throw the same "oldText not found" the user expects.
      return before.includes(needle)
        ? before.replace(needle, replacement)
        : before;
    },
    async execute(args, ctx) {
      const {
        path: input,
        oldText,
        newText,
      } = args as {
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
      // oldText matches a CRLF file (and vice versa). The
      // preview-expansion path (`getFullPreviewContent` below) uses the
      // same helper so its "after" string mirrors what executeEdits
      // would actually write.
      const eol = model.getEOL();
      const needle = normaliseForEol(oldText, eol);
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
      // Await the disk write — the in-memory edit succeeded so the
      // user sees the change, but the agent must hear about a save
      // failure rather than getting `ok: true`.
      await awaitedSaveFile(path, model.getValue());
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
      const { path: input, content } = args as {
        path: string;
        content: string;
      };
      let path = input;
      try {
        path = resolveCreatePath(ctx, input);
      } catch {
        /* preview is non-fatal */
      }
      return {
        kind: 'create',
        path,
        after: truncate(content),
      };
    },
    async getFullContent(args, _ctx, side) {
      // `create_file` has no `before` (the file doesn't exist yet);
      // `after` is the full agent payload from args.
      if (side === 'before') return undefined;
      const { content } = args as { content: string };
      return content;
    },
    async execute(args, ctx) {
      const { path: input, content } = args as {
        path: string;
        content: string;
      };
      // Literal join only — `resolveWorkspacePath`'s fuzzy basename
      // match would silently rewrite e.g. `ollama/intro.md` to
      // `openai/intro.md` if the latter already existed. Create
      // paths must be honoured verbatim.
      const path = resolveCreatePath(ctx, input);
      const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      const parent = lastSlash > 0 ? path.slice(0, lastSlash) : '';
      const name = lastSlash > 0 ? path.slice(lastSlash + 1) : path;
      // Awaited invoke: main mkdir -p's the parent, writes the
      // file, refreshes the tree, and opens the new file as a tab.
      // The structured `{ok, error?}` reply lets us tell the agent
      // when something actually failed (read-only fs, permission
      // denied, etc.) instead of always claiming success.
      const mked = window.mked;
      if (!mked?.createFile) {
        throw new Error(
          'create_file: main-process bridge unavailable (web mode); creating files is desktop-only.',
        );
      }
      const result = await mked.createFile(parent, name, content);
      if (!result.ok) {
        throw new Error(`Failed to create ${path}: ${result.error}`);
      }
      return { ok: true, path: result.path };
    },
  },

  create_folder: {
    description:
      'Create a new (empty) directory at `path`. Auto-creates intermediate directories. Use this whenever you need a folder to exist — do NOT create placeholder `.gitkeep` (or similar) files to make an empty folder visible; the explorer renders empty directories natively.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'New folder path. Use forward slashes; main resolves it under the workspace root.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    // Read-class on purpose: creating an empty directory doesn't
    // touch any user content, can't overwrite anything, and is
    // trivially reversible. Going through the confirm dialog every
    // time would just push the agent back toward the `.gitkeep`
    // workaround it was doing before this tool existed.
    toolClass: 'read',
    async execute(args, ctx) {
      const { path: input } = args as { path: string };
      // Literal join (no fuzzy basename match) — same reasoning as
      // `create_file`: an existing folder with the same name in a
      // different parent must NOT silently rewrite this path.
      const path = resolveCreatePath(ctx, input);
      const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      const parent = lastSlash > 0 ? path.slice(0, lastSlash) : '';
      const name = lastSlash > 0 ? path.slice(lastSlash + 1) : path;
      const mked = window.mked;
      if (!mked?.createFolder) {
        throw new Error(
          'create_folder: main-process bridge unavailable (web mode); creating folders is desktop-only.',
        );
      }
      const result = await mked.createFolder(parent, name);
      if (!result.ok) {
        throw new Error(`Failed to create folder ${path}: ${result.error}`);
      }
      return { ok: true, path: result.path };
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
      const before = selection && model ? model.getValueInRange(selection) : '';
      return {
        kind: 'replace',
        path: ctx.bridge.fileManager.getActiveEditablePath() ?? undefined,
        before: truncate(before),
        after: truncate(content),
      };
    },
    async getFullContent(args, _ctx, side) {
      // `before` is the user's selection at tool-fire time — already
      // captured in the preview; there's nothing further to refetch
      // (re-reading the selection now could disagree with what the
      // tool will actually replace).
      if (side === 'before') return undefined;
      const { content } = args as { content: string };
      return content;
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
      // Save against the editable path so a popped-out diff overlay
      // (`activeFile === 'diff://...'`) doesn't cause us to ship a
      // synthetic id to `to:file:save`. `getActiveEditablePath`
      // already filters out untitled-, so no extra guard is needed.
      const path = ctx.bridge.fileManager.getActiveEditablePath();
      if (path) {
        await awaitedSaveFile(path, editor.getValue());
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
        path: ctx.bridge.fileManager.getActiveEditablePath() ?? undefined,
        after: truncate(content),
      };
    },
    async getFullContent(args, _ctx, side) {
      // Pure insertion — no `before` to expand. `after` is the
      // full args payload.
      if (side === 'before') return undefined;
      const { content } = args as { content: string };
      return content;
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
      // Save against the editable path so a popped-out diff overlay
      // doesn't route a `diff://...` id into `to:file:save`. The
      // accessor already filters out untitled- ids.
      const path = ctx.bridge.fileManager.getActiveEditablePath();
      if (path) {
        await awaitedSaveFile(path, editor.getValue());
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

  async getFullPreviewContent(
    name: string,
    args: unknown,
    side: 'before' | 'after',
  ): Promise<string | undefined> {
    const spec = CATALOG[name];
    if (!spec || !spec.getFullContent) return undefined;
    return spec.getFullContent(args, this.ctx, side);
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
