import hljs from 'highlight.js/lib/core';

// Supported languages for markdown codeblocks
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

import MarkdownIt from 'markdown-it';
import MarkdownItKatex from '@vscode/markdown-it-katex';
import AlertBlock from '../extensions/renderer/AlertBlock';
import LineNumber from '../extensions/renderer/LineNumber';
import LinkTarget from '../extensions/renderer/LinkTarget';
import ImageStyle from '../extensions/renderer/ImageStyle';
import TableStyle from '../extensions/renderer/TableStyle';

import { logger } from '../util';

hljs.registerLanguage('javascript', javascript);
hljs.registerAliases('js', { languageName: 'javascript' });

hljs.registerLanguage('typescript', typescript);
hljs.registerAliases('ts', { languageName: 'typescript' });

hljs.registerLanguage('python', python);
hljs.registerAliases('py', { languageName: 'python' });

hljs.registerLanguage('shell', shell);
hljs.registerAliases('sh', { languageName: 'shell' });
hljs.registerAliases('bash', { languageName: 'shell' });

hljs.registerLanguage('yaml', yaml);
hljs.registerAliases('yml', { languageName: 'yaml' });

hljs.registerLanguage('json', json);
hljs.registerLanguage('php', php);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', c);

/** Languages that render as a "terminal" style (dark, traffic-light dots). */
const terminalLanguages = new Set(['shell', 'sh', 'bash', 'zsh', 'powershell']);

/** Friendly display names for known hljs identifiers. */
const languageDisplayNames: Record<string, string> = {
  javascript: 'JavaScript',
  js: 'JavaScript',
  typescript: 'TypeScript',
  ts: 'TypeScript',
  python: 'Python',
  py: 'Python',
  shell: 'Shell',
  sh: 'Shell',
  bash: 'Bash',
  zsh: 'Zsh',
  yaml: 'YAML',
  yml: 'YAML',
  json: 'JSON',
  php: 'PHP',
  sql: 'SQL',
  xml: 'XML',
  csharp: 'C#',
  rust: 'Rust',
  cpp: 'C++',
  c: 'C',
};

/** SVG copy icon shared between preview + export. */
const copyIconSvg =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="5" y="5" width="8" height="9" rx="1.25"/>' +
  '<path d="M3 10V3a1 1 0 0 1 1-1h7"/>' +
  '</svg>';

/**
 * Render a code block with a header bar (language name + copy button)
 * around the existing hljs-styled <pre><code>. `lang` may be empty
 * when the user writes a fenced block without a language id — in that
 * case we still render the header but skip the language label.
 */
function renderCodeblock(
  rawSource: string,
  highlightedHtml: string,
  lang: string,
) {
  const isTerminal = terminalLanguages.has(lang);
  const label = languageDisplayNames[lang] ?? (lang || '');
  const wrapperClasses = isTerminal
    ? 'md-codeblock md-codeblock--terminal'
    : 'md-codeblock';
  // The source is stored on the wrapper as a base64 data attribute so
  // the copy button can read it without depending on DOM textContent
  // (which would include syntax-highlight span fragments). Encoding
  // as base64 also avoids HTML-attribute escaping headaches.
  let sourceBase64: string;
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(rawSource);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    sourceBase64 = btoa(binary);
  } else {
    sourceBase64 = Buffer.from(rawSource, 'utf-8').toString('base64');
  }

  const dots = isTerminal
    ? '<span class="md-codeblock-dots" aria-hidden="true">' +
      '<i></i><i></i><i></i></span>'
    : '';
  const langLabel = label
    ? `<span class="md-codeblock-lang">${label}</span>`
    : '';

  return (
    `<div class="${wrapperClasses}" data-source="${sourceBase64}">` +
    '<div class="md-codeblock-header">' +
    `${dots}${langLabel}` +
    '<button type="button" class="md-codeblock-copy" aria-label="Copy code">' +
    copyIconSvg +
    '</button>' +
    '</div>' +
    highlightedHtml +
    '</div>'
  );
}

/**
 * Create a new markdownIt instance.
 */
const Markdown = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true,
  highlight: (str: string, lang: string): string => {
    const { escapeHtml } = Markdown.utils;
    if (lang && hljs.getLanguage(lang)) {
      try {
        const code = hljs.highlight(str, {
          language: lang,
          ignoreIllegals: true,
        }).value;

        return renderCodeblock(
          str,
          '<pre class="hljs"><code class="hljs language-' +
            lang +
            '">' +
            code +
            '</code></pre>',
          lang,
        );
      } catch (err) {
        logger?.error('Markdown.highlight', JSON.stringify(err));
      }
    }

    return renderCodeblock(
      str,
      '<pre class="hljs"><code>' + escapeHtml(str) + '</code></pre>',
      lang,
    );
  },
});

// Override the default fence renderer so the `highlight` callback's
// HTML is used verbatim — without it, markdown-it only skips its
// `<pre><code>` wrap when the returned string starts with `<pre`,
// and our `renderCodeblock` wrapper starts with `<div>` so the body
// would otherwise end up inside an extra outer <pre>.
Markdown.renderer.rules.fence = (tokens, idx, options) => {
  const token = tokens[idx];
  const info = token.info ? Markdown.utils.unescapeAll(token.info).trim() : '';
  const langName = info ? info.split(/\s+/g)[0] : '';

  if (options.highlight) {
    const out = options.highlight(token.content, langName, '');
    if (out) return out + '\n';
  }

  return (
    '<pre><code>' + Markdown.utils.escapeHtml(token.content) + '</code></pre>\n'
  );
};

// Only autolink URLs that explicitly include a protocol
Markdown.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });
// Disable non-http(s) protocols
Markdown.linkify.add('ftp:', null).add('mailto:', null);

Markdown.use(AlertBlock);
Markdown.use(LineNumber);
Markdown.use(LinkTarget);
Markdown.use(ImageStyle);
Markdown.use(TableStyle);
Markdown.use(MarkdownItKatex);

/**
 * Render untrusted markdown content (currently: AI Assistant
 * messages, added in P4) through the same singleton instance the
 * preview pane uses, with raw-HTML pass-through disabled for the
 * duration of the call.
 *
 * Why share the instance: the bundle-weight + extension-state cost
 * of a second markdown-it is non-trivial (highlight.js + KaTeX +
 * five plugins). The preview's `html: true` is fine for user-typed
 * content but unsafe for model output — the model could emit
 * `<script>` tags or other XSS vectors. We flip the option
 * synchronously around `render(...)` so any concurrent (impossible
 * in single-threaded JS, but defensive) caller still sees the
 * preview's `html: true` once we restore. Other markdown-it options
 * (linkify, breaks, the highlight callback, the loaded plugins) are
 * preserved.
 */
export function renderAssistantMarkdown(content: string): string {
  const previous = Markdown.options.html;
  Markdown.set({ html: false });
  try {
    return Markdown.render(content);
  } finally {
    Markdown.set({ html: previous });
  }
}

export { Markdown };
