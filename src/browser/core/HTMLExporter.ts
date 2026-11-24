import { dom } from '../dom';
import { exportSettings as defaults } from '../config';
import { markdownStylesheet } from '../markdownStyles';
import type { ExportSettings } from '../interfaces/Editor';
import { logger } from '../util';
import { renderMermaidDiagrams } from '../mermaid';

/**
 * External resources still pulled in via CDN when `withStyles` is on:
 *
 *  - highlight.js theme — provides the syntax-colour rules for the
 *    .hljs class names markdown-it stamps onto fenced code blocks.
 *  - KaTeX — required font + CSS for math rendering.
 */
const cdn = {
  highlightjs: {
    css: {
      rel: 'stylesheet',
      href: 'https://cdn.jsdelivr.net/npm/highlightjs-themes@1.0.0/github.css',
      integrity: 'sha256-3Kq/Y3s2zLxBaWvXF4mw18pnAfq4mSlsi/J2sa9zvSE=',
      crossorigin: 'anonymous',
    },
    js: null,
  },
  katex: {
    css: {
      rel: 'stylesheet',
      href: 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css',
      integrity:
        'sha512-fHwaWebuwA7NSF5Qg/af4UeDx9XqUpYpOGgubo3yWu+b2IQR4UeQwbb42Ti7gVAjNtVoI/I9TEoYeu9omwcC6g==',
      crossorigin: 'anonymous',
    },
    js: {
      src: 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js',
      integrity:
        'sha512-LQNxIMR5rXv7o+b1l8+N1EZMfhG7iFZ9HhnbJkTp4zjNr5Wvst75AqUeFDxeRUa7l5vEDyUiAip//r+EFLLCyA==',
      crossorigin: 'anonymous',
    },
  },
};

/**
 * Inline print-mode highlight.js overrides. The hljs github theme uses
 * subtle background tints that don't print well; this forces readable
 * colours on physical paper / PDF.
 */
const printOverrides = `
@media print {
  .hljs-meta .hljs-string, .hljs-regexp, .hljs-string {
    color: #f7a857;
  }
  .hljs-attr, .hljs-attribute, .hljs-literal, .hljs-meta, .hljs-number,
  .hljs-operator, .hljs-selector-attr, .hljs-selector-class,
  .hljs-selector-id, .hljs-variable {
    color: #78c9e8;
  }
  .hljs-title, .hljs-title.class_, .hljs-title.class_.inherited__,
  .hljs-title.function_ {
    color: #ccda59;
  }
}
`;

/**
 * Inline script baked into exported HTML so the per-codeblock copy
 * buttons keep working in a standalone document (no React, no toast
 * library). Decodes the base64 `data-source` attribute that Markdown.ts
 * stamps on each `.md-codeblock` wrapper, writes the original source
 * to the clipboard, and gives brief visual feedback by toggling a
 * `.is-copied` class on the button for 1.2s.
 */
const codeblockCopyScript = `
(function () {
  if (typeof document === 'undefined') return;
  document.addEventListener('click', async function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var btn = target.closest('.md-codeblock-copy');
    if (!btn) return;
    var wrapper = btn.closest('.md-codeblock');
    var encoded = wrapper && wrapper.getAttribute('data-source');
    if (!encoded) return;
    try {
      var binary = atob(encoded);
      var bytes = Uint8Array.from(binary, function (c) { return c.charCodeAt(0); });
      var text = new TextDecoder().decode(bytes);
      if (!navigator.clipboard || !navigator.clipboard.writeText) return;
      await navigator.clipboard.writeText(text);
      btn.classList.add('is-copied');
      setTimeout(function () { btn.classList.remove('is-copied'); }, 1200);
    } catch (err) { /* noop */ }
  });
})();
`;

type ProviderKey = keyof typeof cdn;

const providers: ProviderKey[] = ['highlightjs', 'katex'];

export class HTMLExporter {
  /** Render diagrams from a snapshot before creating a portable document. */
  static async prepareHTML(
    content: string,
    settings: ExportSettings,
  ): Promise<string> {
    const document = new DOMParser().parseFromString(
      content.trim(),
      'text/html',
    );
    const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(
      settings.background,
    );
    const dark = Boolean(
      settings.withStyles &&
      match &&
      parseInt(match[1], 16) * 0.2126 +
        parseInt(match[2], 16) * 0.7152 +
        parseInt(match[3], 16) * 0.0722 <
        128,
    );
    await renderMermaidDiagrams(
      document.body,
      dark,
      new AbortController().signal,
    );
    for (const block of document.querySelectorAll('[data-diagram="mermaid"]')) {
      const svg = block.querySelector('.md-diagram > svg');
      if (!svg) continue;
      const figure = document.createElement('figure');
      figure.className = 'md-diagram';
      figure.append(svg);
      block.replaceWith(figure);
    }
    return HTMLExporter.generateHTML(
      document.documentElement.outerHTML,
      settings,
    );
  }

  /**
   * Generate HTML export.
   *
   * @param content - the editor content
   * @param settings - export settings
   * @returns - the generated HTML
   */
  static generateHTML(content: string, settings: ExportSettings) {
    const exportSettings = { ...defaults, ...settings };
    const { withStyles, background, fontSize, lineSpacing, fontColor } =
      exportSettings;

    // Create a full HTML document and remove unnecessary attributes and classes
    const document = HTMLExporter.sanitizeHTML(
      new DOMParser().parseFromString(content.trim(), 'text/html'),
    );
    if (!document.querySelector('meta[charset]')) {
      const charset = document.createElement('meta');
      charset.setAttribute('charset', 'utf-8');
      document.head.prepend(charset);
    }

    if (withStyles) {
      // Pull in the external CSS/JS for syntax highlighting + math.
      for (const provides of providers) {
        const { css, js } = cdn[provides];

        if (css) {
          const stylesheet = document.createElement('link');
          stylesheet.rel = css.rel;
          stylesheet.href = css.href;
          stylesheet.integrity = css.integrity;
          stylesheet.crossOrigin = css.crossorigin;
          document.head.appendChild(stylesheet);
        }

        if (js) {
          const script = document.createElement('script');
          script.src = js.src;
          script.integrity = js.integrity;
          script.crossOrigin = js.crossorigin;
          document.body.appendChild(script);
        }
      }

      // Markdown layout + alert + table + code styling, plus print
      // overrides. Same string the live preview uses (see
      // src/browser/markdownStyles.ts) so the export visually matches.
      const style = document.createElement('style');
      style.appendChild(
        document.createTextNode(markdownStylesheet + printOverrides),
      );
      document.head.appendChild(style);

      // Copy-button handler for the .md-codeblock wrappers Markdown.ts
      // emits. Self-contained — no toast library in the export.
      const copyScript = document.createElement('script');
      copyScript.appendChild(document.createTextNode(codeblockCopyScript));
      document.body.appendChild(copyScript);

      // User-driven body styles. These cascade through to
      // #preview-content via `color: inherit` / `font-size: inherit`
      // in markdownStylesheet, so the user's chosen font, size, line
      // height, and colours drive the rendered markdown.
      document.body.style.fontSize = `${fontSize}px`;
      document.body.style.lineHeight = lineSpacing.toString();
      document.body.style.backgroundColor = background;
      document.body.style.color = fontColor;
    } else {
      // Strip document classes, retaining the SVG's own vector styling.
      const elems = document.querySelectorAll('*');
      for (const elem of elems) {
        if (!elem.closest('svg')) elem.removeAttribute('class');
      }
    }

    return `<!DOCTYPE html>${document.documentElement.outerHTML}`;
  }

  /**
   * Sanitizes the HTML for export.
   *
   * @param document - the HTML document
   * @returns - the sanitized HTML
   */
  static sanitizeHTML(document: Document) {
    const metadata = dom.meta.scroll.line;
    // One traversal rather than rescanning large exported documents for
    // each marker. Keep user-authored classes and attributes intact.
    const elements = document.querySelectorAll(
      `[${metadata.start}],[${metadata.end}],.${metadata.class}`,
    );
    for (const element of elements) {
      element.removeAttribute(metadata.start);
      element.removeAttribute(metadata.end);
      element.classList.remove(metadata.class);
      if (element.getAttribute('class') === '')
        element.removeAttribute('class');
    }

    // Return the sanitized HTML
    return document;
  }

  /**
   * Export handler for browser-based exports.
   *
   * @param content - the content to be exported
   * @param mimeType- the mime type
   * @param extension - the file extension
   */
  static async webExport(
    content: string | Promise<string>,
    mimeType: MIMEType = 'text/plain',
    extension: FileExtension = '.md',
  ): Promise<boolean> {
    if (typeof content !== 'string') void content.catch(() => {});
    if (extension === '.pdf') {
      return HTMLExporter.pdfWebExport(content);
    }

    let writable: FileSystemWritableFileStream | null = null;
    try {
      const handle = await window.showSaveFilePicker({
        types: [
          {
            description: 'MKEditor export',
            accept: { [mimeType]: [extension] },
          },
        ],
      });
      const resolved = typeof content === 'string' ? content : await content;
      const blob = new Blob([resolved], { type: mimeType });
      writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      if (writable) {
        try {
          await writable.abort();
        } catch {
          /* best-effort rollback */
        }
      }
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        logger.error('HTMLExporter.webExport', error);
      }
      return false;
    }
  }

  /**
   * Export content as a PDF using the browser's print dialog.
   *
   * @param content - the editor content
   */
  static async pdfWebExport(
    content: string | Promise<string>,
  ): Promise<boolean> {
    if (typeof content !== 'string') void content.catch(() => {});
    // Open a new window with the generated HTML
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      logger.error('Unable to open print window.');
      return false;
    }

    // Write the content and trigger print once loaded
    try {
      const resolved = typeof content === 'string' ? content : await content;
      if (printWindow.closed) return false;
      printWindow.document.documentElement.innerHTML = resolved;
      await HTMLExporter.waitForPrintResources(printWindow);
      if (printWindow.closed) return false;
      printWindow.focus();
      printWindow.print();
      return true;
    } catch (error) {
      logger.error('HTMLExporter.pdfWebExport', error);
      printWindow.close();
      return false;
    }
  }

  private static async waitForPrintResources(win: Window): Promise<void> {
    const cleanup: Array<() => void> = [];
    const pending: Promise<unknown>[] = [];
    for (const resource of win.document.querySelectorAll<
      HTMLLinkElement | HTMLImageElement
    >('link[rel="stylesheet"], img')) {
      const ready =
        resource.tagName === 'IMG'
          ? (resource as HTMLImageElement).complete
          : Boolean((resource as HTMLLinkElement).sheet);
      if (ready) continue;
      pending.push(
        new Promise<void>((resolve) => {
          const done = () => {
            resource.removeEventListener('load', done);
            resource.removeEventListener('error', done);
            resolve();
          };
          resource.addEventListener('load', done, { once: true });
          resource.addEventListener('error', done, { once: true });
          cleanup.push(() => {
            resource.removeEventListener('load', done);
            resource.removeEventListener('error', done);
          });
        }),
      );
    }
    if (pending.length === 0 && !win.document.fonts) return;
    let timer: number | undefined;
    try {
      // Offline CDN resources must not leave a print request hanging forever.
      await Promise.race([
        // Read FontFaceSet.ready after stylesheets finish: loading CSS can
        // initiate a new font-loading cycle after an earlier ready resolved.
        Promise.all(pending).then(() =>
          win.document.fonts?.ready.catch(() => {}),
        ),
        new Promise<void>((resolve) => {
          timer = window.setTimeout(resolve, 5000);
        }),
      ]);
    } finally {
      window.clearTimeout(timer);
      cleanup.forEach((dispose) => dispose());
    }
  }
}
