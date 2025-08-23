import { type editor, languages } from 'monaco-editor/esm/vs/editor/editor.api';
import { dom } from '../../dom';

export class MkedLinkProvider {
  constructor(_: editor.IStandaloneCodeEditor) {
    languages.registerLinkProvider('markdown', {
      provideLinks: async (m) => {
        const mked = window.mked;
        const links: languages.ILink[] = [];
        if (!mked) return { links };

        const active = mked.getActiveFilePath();
        if (!active) return { links };

        const baseDir = await mked.pathDirname(active);
        const text = m.getValue();
        const regex = /\[[^\]]+\]\(([^)]+)\)/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text))) {
          const url = match[1];
          if (!url.endsWith('.md')) continue;
          if (/^[a-zA-Z]+:\/\//.test(url) || url.startsWith('#')) continue;

          const resolved = await mked.resolvePath(baseDir, url);

          let exists = false;
          if (dom.filetree) {
            exists = Array.from(dom.filetree.querySelectorAll('li.file')).some(
              (el) => (el as HTMLElement).dataset.path === resolved,
            );
          }
          if (!exists) continue;

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
