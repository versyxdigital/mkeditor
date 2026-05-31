import type { editor } from 'monaco-editor';

import { t } from '../i18n';
import { sonnerToast } from '../notify';
import { logger } from '../util';
import type { FileManager } from './FileManager';
import type { SettingsProvider } from './providers/SettingsProvider';

/**
 * Result envelope from the IPC / web bridge.
 */
export type PastedImageResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Mode-agnostic writer. The composition root binds this to:
 *   - Desktop: `window.mked.pasteImage(...)` (invoke IPC)
 *   - Web:     `WebFileBridge.pasteImage(...)` (FileSystemDirectoryHandle)
 */
export type PastedImageWriter = (opts: {
  sourceFile: string;
  directory: string;
  bytes: Uint8Array;
  extension: string;
}) => Promise<PastedImageResult>;

/**
 * Catalogue of image MIME types we honour from the clipboard.
 */
const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/**
 * Listen for paste events on the Monaco DOM container.
 */
export class PasteImageHandler {
  private pasteListener: ((event: ClipboardEvent) => void) | null = null;

  constructor(
    private readonly mkeditor: editor.IStandaloneCodeEditor,
    private readonly fileManager: FileManager,
    private readonly settingsProvider: SettingsProvider,
    private readonly writer: PastedImageWriter,
  ) {}

  /**
   * Attach the paste listener.
   */
  public attach(): () => void {
    if (this.pasteListener) return () => this.detach();
    const container = this.mkeditor.getDomNode();
    if (!container) {
      logger?.warn('PasteImageHandler.attach: editor has no DOM node');
      return () => undefined;
    }

    this.pasteListener = (event) => {
      // Paste targets the focused element
      if (!this.mkeditor.hasTextFocus()) return;
      void this.handlePaste(event);
    };

    window.addEventListener('paste', this.pasteListener, { capture: true });
    return () => this.detach();
  }

  public detach(): void {
    if (this.pasteListener) {
      window.removeEventListener('paste', this.pasteListener, {
        capture: true,
      });
    }
    this.pasteListener = null;
  }

  /**
   * Inspect the clipboard, write any image items to disk, and insert
   * markdown references at the cursor.
   */
  private async handlePaste(event: ClipboardEvent): Promise<void> {
    const imageFiles = this.collectImageFiles(
      event.clipboardData?.items,
      event.clipboardData?.files,
    );
    if (imageFiles.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    await this.processImageFiles(imageFiles);
  }

  /**
   * Collect image files from the clipboard.
   */
  private collectImageFiles(
    items: DataTransferItemList | undefined,
    files: FileList | undefined,
  ): { file: File; extension: string }[] {
    const collected: { file: File; extension: string }[] = [];
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== 'file') continue;
        const ext = IMAGE_MIME_TO_EXTENSION[item.type.toLowerCase()];
        if (!ext) continue;
        const file = item.getAsFile();
        if (!file) continue;
        collected.push({ file, extension: ext });
      }
    }
    if (collected.length > 0) return collected;
    // Legacy fallback, only walked when items was empty or
    // contained no image entries.
    if (files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = IMAGE_MIME_TO_EXTENSION[file.type.toLowerCase()];
        if (!ext) continue;
        collected.push({ file, extension: ext });
      }
    }
    return collected;
  }

  /**
   * Write each image to disk via the configured writer, then insert
   * `![](relative-path)` at the cursor.
   */
  private async processImageFiles(
    imageFiles: { file: File; extension: string }[],
  ): Promise<void> {
    const sourceFile = this.fileManager.getActiveEditablePath();
    if (!sourceFile) {
      sonnerToast('warning', t('notifications:pasted_image_no_workspace'));
      return;
    }

    const directory =
      this.settingsProvider.getSetting('pasteImages')?.directory?.trim() ||
      './assets';

    for (const { file, extension } of imageFiles) {
      try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const result = await this.writer({
          sourceFile,
          directory,
          bytes,
          extension,
        });
        if (!result.ok) {
          sonnerToast(
            'error',
            `${t('notifications:pasted_image_failed')} — ${result.error}`,
          );
          continue;
        }
        this.insertMarkdownLink(sourceFile, result.path);
        sonnerToast(
          'success',
          t('notifications:pasted_image_saved', { path: result.path }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sonnerToast(
          'error',
          `${t('notifications:pasted_image_failed')} — ${message}`,
        );
        logger?.error('PasteImageHandler.processImageFiles', message);
      }
    }
  }

  /**
   * Insert `![](<relative-path>)` at the editor's current cursor.
   */
  private insertMarkdownLink(sourceFile: string, savedPath: string): void {
    const relative = relativePath(dirOf(sourceFile), savedPath);
    const encoded = encodeRelativeMarkdownPath(relative);
    const snippet = `![](${encoded})`;
    const selection = this.mkeditor.getSelection();
    if (!selection) return;
    this.mkeditor.executeEdits('paste-image', [
      {
        range: selection,
        text: snippet,
        forceMoveMarkers: true,
      },
    ]);
    // After insert, drop selection inside the alt-text gap so the
    // user can immediately type alt text without re-selecting.
    const insertedColumnOffset = 2; // `![` is 2 chars
    this.mkeditor.setSelection({
      startLineNumber: selection.startLineNumber,
      startColumn: selection.startColumn + insertedColumnOffset,
      endLineNumber: selection.startLineNumber,
      endColumn: selection.startColumn + insertedColumnOffset,
    });
    this.mkeditor.focus();
  }
}

/* -------------------------------------------------------------------- */
/*  Path helpers — POSIX/Windows agnostic                                 */
/* -------------------------------------------------------------------- */

function dirOf(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx < 0 ? '' : norm.slice(0, idx);
}

/**
 * Build the markdown-relative path from `fromDir` to `toPath`.
 */
export function relativePath(fromDir: string, toPath: string): string {
  const from = fromDir.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  const to = toPath.replace(/\\/g, '/').split('/');
  // Find the common prefix.
  let i = 0;
  while (
    i < from.length &&
    i < to.length - 1 &&
    samePathSegment(from[i], to[i])
  ) {
    i++;
  }
  const up: string[] = [];
  for (let j = i; j < from.length; j++) up.push('..');
  const down = to.slice(i);
  if (up.length === 0 && down.length > 0) {
    // Sibling / descendant — markdown convention is to prefix with
    // `./` so the link is unambiguously relative (and not a top-level
    // URL fragment).
    return './' + down.join('/');
  }
  return [...up, ...down].join('/');
}

/**
 * Case-insensitive comparison on Windows-style paths (drive letters
 * present anywhere in the input), case-sensitive on POSIX.
 */
function samePathSegment(a: string, b: string): boolean {
  if (a === b) return true;
  if (/^[a-zA-Z]:$/.test(a) || /^[a-zA-Z]:$/.test(b)) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return false;
}

/**
 * URL-encode each segment so spaces / unicode round-trip cleanly
 * through markdown-it; do NOT encode the path separators.
 */
function encodeRelativeMarkdownPath(rel: string): string {
  return rel
    .split('/')
    .map((seg) => (seg === '.' || seg === '..' ? seg : encodeURIComponent(seg)))
    .join('/');
}
