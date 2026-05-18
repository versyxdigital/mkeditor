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
  /**
   * Format version. v1 was the original session-restore shape; v2 adds
   * the optional `assistant` view-state block. The loader accepts either
   * version (a v1 file loads with `assistant` undefined) and the writer
   * always stamps the current `AppSession.SCHEMA_VERSION` (2 today).
   */
  version: 1 | 2;
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
  /**
   * AI Assistant right-sidebar view state, added in v2 (AI Assistant P2).
   * Optional so v1 payloads load unchanged; UIStateContext supplies
   * sensible defaults when absent. Conversation history lives in
   * `~/.mkeditor/assistant.json`, not here — this block is purely the
   * layout/visibility snapshot the renderer hydrates at boot.
   */
  assistant?: AssistantViewState;
}

export interface AssistantViewState {
  /** Whether the right sidebar is expanded. */
  sidebarOpen: boolean;
  /**
   * Last-selected size as a percentage of the outer Group's width.
   * `react-resizable-panels` stores layout in percent; we round-trip
   * the same scale so re-applying it matches the user's drag exactly.
   */
  size: number;
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
