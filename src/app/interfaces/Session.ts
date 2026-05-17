/**
 * Persisted session shape. Mirrors the schema documented in
 * `docs/SESSION_RESTORE.md` and the renderer-side serializer in
 * `FileManager.serializeSession()` (added in Phase 2).
 *
 * Main process never interprets `viewState` — it's a JSON-serialisable
 * opaque blob owned by Monaco (`editor.ICodeEditorViewState`). Typed as
 * `unknown` here so the main process compiles without pulling Monaco
 * into the node-side bundle.
 */
export interface SessionPayload {
  /** Format version. Bump on shape changes; current loader rejects mismatches. */
  version: 1;
  /** Insertion order is tab order. */
  tabs: SessionTab[];
  /** Path of the active tab. Must match a `tabs[].path` or be null. */
  activeFile: string | null;
  /**
   * Currently-open workspace folder path, or null. Main re-validates
   * this at restore time and drops it if the directory no longer
   * exists. Desktop only; web mode handles its root via IDB (P3).
   */
  workspaceRoot: string | null;
}

export interface SessionTab {
  /** Real file path, or a synthetic `untitled-N` id. */
  path: string;
  /** Display name (tab label). */
  name: string;
  /** Monaco view state — cursor, selection, scroll, folding. Null when never activated. */
  viewState: unknown;
  /** Inline content. Present iff `path.startsWith('untitled')` AND the buffer is non-empty. */
  untitledContent?: string;
}

/**
 * Wire envelope sent to the renderer on `from:session:restore`. Main
 * pre-validates real-file paths against the filesystem, drops missing
 * ones from the session, lists them under `missing`, and embeds the
 * file contents under `contents` so the renderer can replay tabs
 * synchronously without a second IPC round-trip per file.
 */
export interface SessionRestoreEnvelope {
  /** Filtered session — missing real-file tabs already removed. */
  session: SessionPayload | null;
  /** Real-file paths that were in the persisted session but no longer exist. */
  missing: string[];
  /** Map of real-file path → file contents, for every kept real-file tab. */
  contents: Record<string, string>;
}
