import { editor, languages } from 'monaco-editor/esm/vs/editor/editor.api';
import { dom } from '../dom';

export class LinkProvider {
  constructor(_model: editor.IStandaloneCodeEditor) {
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
            console.log('filetree exists');
            exists = Array.from(dom.filetree.querySelectorAll('li.file')).some(
              (el) => (el as HTMLElement).dataset.path === resolved,
            );
          }
          if (!exists) continue;

          const startOffset = match.index + match[0].indexOf(url);
          const endOffset = startOffset + url.length;
          const startPos = m.getPositionAt(startOffset);
          const endPos = m.getPositionAt(endOffset);

          links.push({
            range: {
              startLineNumber: startPos.lineNumber,
              startColumn: startPos.column,
              endLineNumber: endPos.lineNumber,
              endColumn: endPos.column,
            },
            url: `mked://open?path=${encodeURIComponent(resolved)}`,
          });
        }

        console.log(links);
        return { links };
      },
    });
  }
}
