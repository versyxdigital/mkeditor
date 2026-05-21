import { type editor, languages } from 'monaco-editor';

/**
 * Getter returning the absolute path of the currently-editable tab —
 * the file Monaco is actually backing — or `null` when there's no
 * such tab (untitled-only session, or only diff overlays open).
 *
 * Sourced from `FileManager.getActiveEditablePath()` in the
 * composition root (not raw `activeFile`, which can hold a
 * synthetic `diff://...` id while a popped-out diff preview is
 * showing). Reading from the renderer here (instead of
 * `mked.getActiveFilePath()` via IPC) is what makes link
 * resolution stay correct when the user switches tabs — the main
 * process never learns about tab switches, only about
 * `from:file:opened`, so its `activeFilePath` lags reality.
 */
export type ActiveFilePathGetter = () => string | null;

export class MkedLinkProvider {
  constructor(
    _: editor.IStandaloneCodeEditor,
    getActiveFilePath: ActiveFilePathGetter,
  ) {
    languages.registerLinkProvider('markdown', {
      provideLinks: async (m) => {
        const mked = window.mked;
        const links: languages.ILink[] = [];
        if (!mked) return { links };

        // Untitled buffers have a synthetic id (`untitled-N`), not a
        // real path — `dirname` would resolve relative to the
        // Electron process cwd, which is never what the user wants.
        const active = getActiveFilePath();
        if (!active || active.startsWith('untitled')) return { links };

        const baseDir = await mked.pathDirname(active);
        const text = m.getValue();
        const regex = /\[[^\]]+\]\(([^)]+)\)/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text))) {
          const url = match[1];
          if (!url.endsWith('.md')) continue;
          if (/^[a-zA-Z]+:\/\//.test(url) || url.startsWith('#')) continue;

          const resolved = await mked.resolvePath(baseDir, url);

          // No tree-presence gate. The link is offered for every
          // relative .md path syntactically present in the doc;
          // `AppStorage.openActiveFile` checks existence at click
          // time and surfaces an error toast if the target is gone.
          // Gating on the loaded tree meant unexpanded folders'
          // files were unlinkable, which was the most common
          // complaint with the old behaviour.

          const startOffset = match.index + match[0].indexOf(url);
          const endOffset = startOffset + url.length;
          const startPos = m.getPositionAt(startOffset);
          const endPos = m.getPositionAt(endOffset);

          // NOTE: no 'url' here - let resolveLink handle it
          const link: languages.ILink = {
            range: {
              startLineNumber: startPos.lineNumber,
              startColumn: startPos.column,
              endLineNumber: endPos.lineNumber,
              endColumn: endPos.column,
            },
            tooltip: `Open ${url}`,
          };

          // stash the absolute path so resolveLink can use it
          (link as any).__absPath = resolved;

          links.push(link);
        }

        return { links };
      },
      resolveLink: async (link) => {
        const mked = window.mked;
        if (!mked) return link;
        const abs = (link as any).__absPath as string | undefined;
        if (!abs) return link;

        await mked.openMkedUrl(`mked://open?path=${encodeURIComponent(abs)}`);

        // Returning null tells Monaco "we handled it; don't navigate"
        return null;
      },
    });
  }
}
