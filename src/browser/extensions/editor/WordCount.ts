/**
 * Count written words.
 *
 * @param value - the editor model content
 */
const WordCount = (value: string) => {
  const text = stripMarkdown(value);
  let count = countWords(text);
  if (count && count < 0) count = 0;

  const wc = document.querySelector('#word-count');
  if (wc) wc.innerHTML = count?.toString() ?? '0';
};

/**
 * Count written characters.
 *
 * @param value - the editor model content
 */
const CharacterCount = (value: string) => {
  const text = stripMarkdown(value);
  let count = countCharacters(text);
  if (count && count < 0) count = 0;

  const cc = document.querySelector('#character-count');
  if (cc) cc.innerHTML = count?.toString() ?? '0';
};

/**
 * Strip markdown from the editor model content.
 *
 * @param value - the editor model content
 * @returns the stripped content
 */
function stripMarkdown(value: string) {
  return (
    value
      // Remove fenced code blocks (``` or ~~~)
      .replace(/(^|\n)```[^\n]*\n([\s\S]*?)```/g, (_m, p1, code) => p1 + code)
      .replace(/(^|\n)~~~[^\n]*\n([\s\S]*?)~~~/g, (_m, p1, code) => p1 + code)
      // Remove fenced alert blocks (:::)
      .replace(
        /(^|\n):::\s*\w+[^\n]*\n([\s\S]*?)\n:::/g,
        (_m, p1, content) => p1 + content,
      )
      // Remove inline code but keep surrounding text
      .replace(/`[^`]*`/g, ' ')
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Admonition-style blocks ::: ... :::
      .replace(/(^|\n)::{3,}[\s\S]*?\n::{3,}\s*/g, ' ')
      // Images: keep alt text
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Links: keep link text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Reference-style link/image definitions
      .replace(/^\s*\[[^\]]+]:\s+\S+.*$/gm, ' ')
      // Footnotes: definitions and inline refs
      .replace(/^\s*\[\^[^\]]+]:.*$/gm, ' ')
      .replace(/\[\^[^\]]+]/g, ' ')
      // Task list checkboxes
      .replace(/^[ \t]*[-+*]\s+\[[ xX]\]\s+/gm, '')
      // Unordered/ordered list markers at line start
      .replace(/^[ \t]*[-+*]\s+/gm, '')
      .replace(/^[ \t]*\d+\.\s+/gm, '')
      // Blockquote markers at line start
      .replace(/^[ \t]*>\s?/gm, '')
      // Setext heading underlines
      .replace(/^[ \t]*={2,}\s*$/gm, ' ')
      .replace(/^[ \t]*-{2,}\s*$/gm, ' ')
      // Strip HTML tags but keep their inner text
      .replace(/<\/?[^>\n]+>/g, ' ')
      // Remove Markdown emphasis delimiters only when they wrap word chars
      .replace(/(\B\*|\*\B|\B_|_\B|~~)/g, '')
      // Remove remaining backticks/tilde runs used as formatting
      .replace(/`{1,3}|~{2,}/g, ' ')
      // Inline math delimiters: keep contents
      .replace(/\${1,2}([^$]+)\${1,2}/g, '$1')
      // Normalize newlines and collapse to single spaces
      .replace(/\r?\n|\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function countCharacters(str: string) {
  return str.length;
}

function countWords(str: string) {
  const words = str.match(/\S+/g);
  return words && words.length ? words.length : 0;
}

export { WordCount, CharacterCount };
