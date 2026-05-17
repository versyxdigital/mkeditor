import type { editor } from 'monaco-editor';

/**
 * Persisted session shape (renderer-side view). Wire-compatible with
 * `src/app/interfaces/Session.ts`: identical field names and optionality.
 * The only difference is `viewState` is typed against Monaco's
 * `editor.ICodeEditorViewState` here so the renderer can use Monaco's
 * own save/restore APIs without casting.
 */
export interface SessionPayload {
  version: 1;
  tabs: SessionTab[];
  activeFile: string | null;
  /** Workspace root path (desktop). Null when no folder is open. */
  workspaceRoot: string | null;
}

export interface SessionTab {
  path: string;
  name: string;
  viewState: editor.ICodeEditorViewState | null;
  untitledContent?: string;
}

/**
 * Wire envelope sent from main on `from:session:restore`. Real-file
 * paths in the original session have been filtered against the
 * filesystem; missing ones are listed in `missing`, surviving ones'
 * contents are pre-loaded in `contents` so the renderer can replay
 * tabs synchronously.
 */
export interface SessionRestoreEnvelope {
  session: SessionPayload | null;
  missing: string[];
  contents: Record<string, string>;
}
