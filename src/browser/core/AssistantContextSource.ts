import type { BridgeManager } from './BridgeManager';
import type { AssistantContextProvider } from './AssistantManager';

/**
 * P6 — implementation of `AssistantContextProvider` that reaches into
 * the live `FileManager` / Monaco editor / `window.mked.readFile` via
 * the `BridgeManager` ref. Kept separate from `AssistantTools` because
 * the context surface is read-only and stateless — it doesn't deserve
 * to share the tool-dispatch class's confirmation / classification
 * machinery.
 *
 * Constructed by `BridgeManager` and handed to
 * `AssistantManager.setContextProvider`. The manager owns the chat
 * state + context-message assembly; this class is purely the access
 * layer for active-file / selection / arbitrary-file content.
 */
export class AssistantContextSource implements AssistantContextProvider {
  constructor(private readonly bridge: BridgeManager) {}

  /**
   * Active tab's path + current model content. Returns null for the
   * untitled scratch buffer (no stable on-disk path) so the agent
   * doesn't see a phantom "untitled-3 (active)" chip when the user
   * hasn't actually opened a file yet.
   */
  getActiveFile(): { path: string; content: string } | null {
    const fm = this.bridge.fileManager;
    const path = fm.activeFile;
    if (!path || path.startsWith('untitled-')) return null;
    const model = fm.models.get(path);
    if (!model) return null;
    return { path, content: model.getValue() };
  }

  /**
   * Live selection in the editor, mapped to a `{ path, text, lineRange }`
   * shape. Null when there's no selection or the selection is empty
   * (Monaco treats a bare cursor as a "selection" with identical start
   * and end positions; we filter those out so the share-selection chip
   * doesn't appear when the user just has the cursor parked somewhere).
   */
  getSelection(): {
    path: string | null;
    text: string;
    startLine: number;
    endLine: number;
  } | null {
    const editor = this.bridge.mkeditor;
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || !model) return null;
    const text = model.getValueInRange(selection);
    if (!text) return null;
    const fm = this.bridge.fileManager;
    const active = fm.activeFile;
    const path = active && !active.startsWith('untitled-') ? active : null;
    return {
      path,
      text,
      startLine: selection.startLineNumber,
      endLine: selection.endLineNumber,
    };
  }

  /**
   * Read a file by absolute path. Open Monaco models win over disk so
   * the agent sees unsaved edits the user has typed; otherwise we go
   * through the same `mked:fs:readfile` invoke helper the `read_file`
   * tool uses (P5 polish that kept tab-spam down).
   */
  async readFile(path: string): Promise<{ content: string }> {
    const open = this.bridge.fileManager.models.get(path);
    if (open) return { content: open.getValue() };
    const mked = window.mked;
    if (!mked?.readFile) {
      throw new Error(
        `AssistantContextSource.readFile: main-process bridge unavailable (web mode); cannot read ${path}.`,
      );
    }
    const { content } = await mked.readFile(path);
    return { content };
  }
}
