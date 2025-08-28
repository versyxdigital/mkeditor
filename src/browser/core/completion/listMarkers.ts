import type { editor } from 'monaco-editor';

/**
 * Auto-continue list markers.
 *
 * @param mkeditor - the editor instance.
 */
export const autoContinueListMarkers = (
  mkeditor: editor.IStandaloneCodeEditor | null,
) => {
  const model = mkeditor?.getModel();
  const position = mkeditor?.getPosition();

  if (model && position) {
    const prevLineNumber = Math.max(1, position.lineNumber - 1);
    const prevLineText = model.getLineContent(prevLineNumber);

    // Derive next list prefix from previous line
    const nextPrefix = getNextListPrefix(prevLineText);
    if (nextPrefix) {
      const selection = mkeditor?.getSelection();
      if (selection) {
        const insertRange = {
          startLineNumber: selection.positionLineNumber,
          startColumn: selection.positionColumn,
          endLineNumber: selection.positionLineNumber,
          endColumn: selection.positionColumn,
        };

        mkeditor?.executeEdits('mkeditor:auto-list', [
          {
            range: insertRange,
            text: nextPrefix,
            forceMoveMarkers: true,
          },
        ]);
      }
    }
  }
};

/**
 * Determine the next list prefix (e.g. "2. ", "- ") based on previous line.
 *
 * @param line - the line content
 * @returns
 */
export const getNextListPrefix = (line: string): string | null => {
  // Checkbox list (e.g. "- [ ] item" or "- [x] item") -> continue with unchecked box
  const checkbox = line.match(/^(\s*)([-+*])\s+\[[ xX]\](?:\s+|$)/);
  if (checkbox) {
    const marker = checkbox[2];
    return `${marker} [ ] `;
  }

  // Unordered lists: preserve the same marker the user used
  const unordered = line.match(/^(\s*)([-+*])(?:\s+|$)/);
  if (unordered) {
    const marker = unordered[2];
    return `${marker} `;
  }

  // Ordered lists: increment the number and preserve delimiter
  const ordered = line.match(/^(\s*)(\d+)([.)])(?:\s+|$)/);
  if (ordered) {
    const n = parseInt(ordered[2], 10) + 1;
    const delim = ordered[3];
    return `${n}${delim} `;
  }

  return null;
};
