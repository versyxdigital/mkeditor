/**
 * Stylesheet for rendered markdown — used by both the live preview pane
 * and the HTML export. Single source of truth so the live preview always
 * matches what the user gets when they export.
 *
 * Architecture notes:
 *  - All rules are scoped to `#preview-content` (the wrapper that holds
 *    the markdown-it output in both contexts).
 *  - Text colour, font-size, and line-height are `inherit` so the body
 *    can drive them. In the live preview the body picks up Tailwind's
 *    `--foreground` token; in the export `ExportSettingsProvider` writes
 *    inline `style="font-size; line-height; color; background"` onto the
 *    body via the user's ExportSettings.
 *  - A small set of CSS custom properties (`--md-*`) controls secondary
 *    colours (borders, muted text, code/table backgrounds, link colour).
 *    They flip with darkmode via `[data-theme='dark']` for the live
 *    preview; the export keeps the light defaults because the user's
 *    `background` and `fontColor` are the source of truth there.
 *  - Custom `:::` alert blocks use a modern flat design: soft tinted
 *    background, coloured left border, and a small uppercase label
 *    rendered via `::before`. No icon font dependency.
 *
 * The constant is consumed in two places:
 *   - `src/browser/index.ts` injects it into a `<style id="md-styles">`
 *     element appended to `document.head` at boot.
 *   - `src/browser/core/HTMLExporter.ts` inlines the same string into
 *     the exported document's `<head>` when `withStyles` is on.
 */
export const markdownStylesheet = `
:root {
  --md-border: #d1d9e0;
  --md-muted-fg: #59636e;
  --md-muted-bg: #f6f8fa;
  --md-code-bg: rgba(175, 184, 193, 0.2);
  --md-link: #0969da;
}

[data-theme='dark'] {
  --md-border: #30363d;
  --md-muted-fg: #9198a1;
  --md-muted-bg: #161b22;
  --md-code-bg: rgba(110, 118, 129, 0.4);
  --md-link: #2f81f7;
}

/* ===== Base ===== */

#preview-content {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans',
    Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';
  font-size: inherit;
  line-height: inherit;
  color: inherit;
  word-wrap: break-word;
}

#preview-content > *:first-child { margin-top: 0; }
#preview-content > *:last-child  { margin-bottom: 0; }

#preview-content p,
#preview-content blockquote,
#preview-content ul,
#preview-content ol,
#preview-content dl,
#preview-content table,
#preview-content pre {
  margin: 0 0 16px 0;
}

/* ===== Headings ===== */

#preview-content h1,
#preview-content h2,
#preview-content h3,
#preview-content h4,
#preview-content h5,
#preview-content h6 {
  margin: 24px 0 16px;
  font-weight: 600;
  line-height: 1.25;
}

#preview-content h1,
#preview-content h2 {
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--md-border);
}

#preview-content h1 { font-size: 2em;     }
#preview-content h2 { font-size: 1.5em;   }
#preview-content h3 { font-size: 1.25em;  }
#preview-content h4 { font-size: 1em;     }
#preview-content h5 { font-size: 0.875em; }
#preview-content h6 { font-size: 0.85em; color: var(--md-muted-fg); }

/* ===== Lists =====
 * Tailwind's base layer resets list-style on ul/ol, so we re-assert the
 * GitHub-style nested bullets and numerals here.
 */

#preview-content ul,
#preview-content ol { padding-left: 2em; }

#preview-content ul { list-style: disc; }
#preview-content ul ul { list-style: circle; }
#preview-content ul ul ul { list-style: square; }

#preview-content ol { list-style: decimal; }
#preview-content ol ol { list-style: lower-alpha; }
#preview-content ol ol ol { list-style: lower-roman; }

#preview-content ul ul, #preview-content ul ol,
#preview-content ol ul, #preview-content ol ol { margin: 0; }

#preview-content li + li { margin-top: 0.25em; }
#preview-content li > p  { margin-top: 16px; }

/* Task list rows (markdown-it stamps an <input type=checkbox> at the
 * start of the li). Drop the bullet so the checkbox sits cleanly at
 * the start of the row. */
#preview-content li.task-list-item,
#preview-content li:has(> input[type='checkbox']) {
  list-style: none;
  margin-left: -1.5em;
}
#preview-content li.task-list-item > input[type='checkbox'],
#preview-content li > input[type='checkbox'] {
  margin-right: 0.5em;
}

/* ===== Blockquote ===== */

#preview-content blockquote {
  padding: 0 1em;
  color: var(--md-muted-fg);
  border-left: 0.25em solid var(--md-border);
  margin: 0 0 16px;
}

#preview-content blockquote > :first-child { margin-top: 0; }
#preview-content blockquote > :last-child  { margin-bottom: 0; }

/* ===== Code ===== */

#preview-content code,
#preview-content tt {
  padding: 0.2em 0.4em;
  margin: 0;
  font-size: 85%;
  white-space: break-spaces;
  background: var(--md-code-bg);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas,
    'Liberation Mono', monospace;
}

#preview-content pre {
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background: var(--md-muted-bg);
  border-radius: 6px;
}

#preview-content pre > code {
  padding: 0;
  margin: 0;
  white-space: pre;
  word-break: normal;
  background: transparent;
  border: 0;
  font-size: 100%;
}

/* ===== Tables ===== */

#preview-content table {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow: auto;
  border-spacing: 0;
  border-collapse: collapse;
}

#preview-content table th,
#preview-content table td {
  padding: 6px 13px;
  border: 1px solid var(--md-border);
}

#preview-content table th {
  font-weight: 600;
  background: var(--md-muted-bg);
}

#preview-content table tr:nth-child(2n) { background: var(--md-muted-bg); }

/* ===== Images ===== */

#preview-content img {
  max-width: 100%;
  height: auto;
}

/* ===== Horizontal rule ===== */

#preview-content hr {
  height: 2px;
  padding: 0;
  margin: 24px 0;
  background: var(--md-border);
  border: 0;
}

/* ===== Links ===== */

#preview-content a {
  color: var(--md-link);
  text-decoration: none;
}

#preview-content a:hover { text-decoration: underline; }

/* ===== Keyboard ===== */

#preview-content kbd {
  display: inline-block;
  padding: 3px 5px;
  font-size: 11px;
  line-height: 10px;
  vertical-align: middle;
  background: var(--md-muted-bg);
  border: solid 1px var(--md-border);
  border-radius: 6px;
  box-shadow: inset 0 -1px 0 var(--md-border);
}

/* ===== Container width (ExportSettings.container) ===== */

#preview-content.container {
  max-width: 960px;
  margin-left: auto;
  margin-right: auto;
  padding: 0 16px;
}

#preview-content.container-fluid {
  max-width: 100%;
  padding: 0 16px;
}

/* ===== Custom alert blocks ===== */
/* Modern flat design: soft tinted background, coloured left border,
 * uppercase label rendered via ::before. No icon-font dependency.
 * Matches the eight types AlertBlock.ts emits.
 */

#preview-content .alert {
  padding: 12px 16px;
  margin: 16px 0;
  border-radius: 6px;
  border-left: 4px solid;
}

#preview-content .alert > *:first-child { margin-top: 0; }
#preview-content .alert > *:last-child  { margin-bottom: 0; }

#preview-content .alert::before {
  display: block;
  margin-bottom: 6px;
  font-weight: 700;
  font-size: 0.75em;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

#preview-content .alert a.alert-link { font-weight: 600; }

#preview-content .alert-info {
  background: rgba(9, 105, 218, 0.08);
  border-color: #0969da;
}
#preview-content .alert-info::before { content: 'Info'; color: #0969da; }
#preview-content .alert-info a.alert-link { color: #0969da; }

#preview-content .alert-success {
  background: rgba(31, 136, 61, 0.08);
  border-color: #1f883d;
}
#preview-content .alert-success::before { content: 'Success'; color: #1f883d; }
#preview-content .alert-success a.alert-link { color: #1f883d; }

#preview-content .alert-warning {
  background: rgba(154, 103, 0, 0.08);
  border-color: #9a6700;
}
#preview-content .alert-warning::before { content: 'Warning'; color: #9a6700; }
#preview-content .alert-warning a.alert-link { color: #9a6700; }

#preview-content .alert-danger {
  background: rgba(207, 34, 46, 0.08);
  border-color: #cf222e;
}
#preview-content .alert-danger::before { content: 'Danger'; color: #cf222e; }
#preview-content .alert-danger a.alert-link { color: #cf222e; }

#preview-content .alert-primary {
  background: rgba(81, 144, 136, 0.10);
  border-color: #519088;
}
#preview-content .alert-primary::before { content: 'Note'; color: #519088; }
#preview-content .alert-primary a.alert-link { color: #519088; }

#preview-content .alert-secondary {
  background: rgba(89, 99, 110, 0.10);
  border-color: #59636e;
}
#preview-content .alert-secondary::before { content: 'Aside'; color: #59636e; }
#preview-content .alert-secondary a.alert-link { color: #59636e; }

#preview-content .alert-light {
  background: rgba(208, 215, 222, 0.30);
  border-color: #d0d7de;
}
#preview-content .alert-light::before { content: 'Tip'; color: #59636e; }

#preview-content .alert-dark {
  background: rgba(31, 35, 40, 0.10);
  border-color: #1f2328;
}
#preview-content .alert-dark::before { content: 'Important'; color: #1f2328; }
#preview-content .alert-dark a.alert-link { color: #1f2328; }

/* Dark-mode background lifts for the alerts. Borders + label colours
 * are kept the same; the slightly higher alpha keeps the soft fill
 * visible against the dark editor background. */

[data-theme='dark'] #preview-content .alert-info      { background: rgba(47, 129, 247, 0.12); }
[data-theme='dark'] #preview-content .alert-success   { background: rgba(56, 139, 60, 0.15);  }
[data-theme='dark'] #preview-content .alert-warning   { background: rgba(187, 128, 9, 0.15);  }
[data-theme='dark'] #preview-content .alert-danger    { background: rgba(248, 81, 73, 0.15);  }
[data-theme='dark'] #preview-content .alert-primary   { background: rgba(81, 144, 136, 0.20); }
[data-theme='dark'] #preview-content .alert-secondary { background: rgba(110, 118, 129, 0.20); }
[data-theme='dark'] #preview-content .alert-light     { background: rgba(110, 118, 129, 0.10); border-color: #30363d; }
[data-theme='dark'] #preview-content .alert-dark      { background: rgba(230, 237, 243, 0.10); border-color: #e6edf3; }
[data-theme='dark'] #preview-content .alert-dark::before    { color: #e6edf3; }
[data-theme='dark'] #preview-content .alert-dark a.alert-link { color: #e6edf3; }

/* ===== Print ===== */

@media print {
  #preview-content {
    color: #000;
  }
  #preview-content a { color: #000; text-decoration: underline; }
  #preview-content pre,
  #preview-content code,
  #preview-content kbd {
    background: #f6f8fa !important;
  }
}
`;
