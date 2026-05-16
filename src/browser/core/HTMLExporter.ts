import { dom } from '../dom';
import { exportSettings as defaults } from '../config';
import { markdownStylesheet } from '../markdownStyles';
import type { ExportSettings } from '../interfaces/Editor';

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

type ProviderKey = keyof typeof cdn;

const providers: ProviderKey[] = ['highlightjs', 'katex'];

export class HTMLExporter {
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

      // User-driven body styles. These cascade through to
      // #preview-content via `color: inherit` / `font-size: inherit`
      // in markdownStylesheet, so the user's chosen font, size, line
      // height, and colours drive the rendered markdown.
      document.body.style.fontSize = `${fontSize}px`;
      document.body.style.lineHeight = lineSpacing.toString();
      document.body.style.backgroundColor = background;
      document.body.style.color = fontColor;
    } else {
      // No styles — strip every class so the export is plain HTML.
      const elems = document.querySelectorAll('*');
      for (const elem of elems) {
        elem.removeAttribute('class');
      }
    }

    return `<!DOCTYPE html>${document.documentElement.innerHTML}`;
  }

  /**
   * Sanitizes the HTML for export.
   *
   * @param document - the HTML document
   * @returns - the sanitized HTML
   */
  static sanitizeHTML(document: Document) {
    // Define attributes and classes for removal
    const removals = {
      attrs: [dom.meta.scroll.line.start, dom.meta.scroll.line.end],
      classes: [dom.meta.scroll.line.class],
    };

    // Loop through and remove attributes
    for (const removeAttr of removals.attrs) {
      const elems = document.querySelectorAll(`[${removeAttr}]`);
      for (const elem of elems) {
        if (elem.hasAttribute(removeAttr)) {
          elem.removeAttribute(removeAttr);
        }
      }
    }

    // Loop through and remove classes
    for (const removeClass of removals.classes) {
      const elems = document.querySelectorAll(`.${removeClass}`);
      for (const elem of elems) {
        if (elem.hasAttribute('class')) {
          elem.classList.remove(removeClass);
          if (elem.classList.length === 0) {
            elem.removeAttribute('class');
          }
        }
      }
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
  static webExport(
    content: string,
    mimeType: MIMEType = 'text/plain',
    extension: FileExtension = '.md',
  ) {
    if (extension === '.pdf') {
      return HTMLExporter.pdfWebExport(content);
    }

    const blob = new Blob([content], { type: mimeType });

    async function createHandle() {
      return await window.showSaveFilePicker({
        types: [
          {
            description: 'MKEditor export',
            accept: { [mimeType]: [extension] },
          },
        ],
      });
    }

    createHandle().then((handle) => {
      handle.createWritable().then(async (writable) => {
        await writable.write(blob);
        await writable.close();
      });
    });
  }

  /**
   * Export content as a PDF using the browser's print dialog.
   *
   * @param content - the editor content
   */
  static pdfWebExport(content: string) {
    const awaitStyles = (win: Window, cb: () => void) => {
      const links = Array.from(
        win.document.querySelectorAll('link[rel="stylesheet"]'),
      ) as HTMLLinkElement[];

      let loaded = 0;
      if (links.length === 0) return cb();

      links.forEach((link) => {
        link.addEventListener('load', () => {
          loaded++;
          if (loaded === links.length) cb();
        });
        link.addEventListener('error', () => {
          loaded++;
          if (loaded === links.length) cb();
        });
      });
    };

    // Open a new window with the generated HTML
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      console.error('Unable to open print window.');
      return;
    }

    // Write the content and trigger print once loaded
    printWindow.document.documentElement.innerHTML = content;

    // Wait for stylesheets and resources to load before printing
    awaitStyles(printWindow, () => {
      printWindow.focus();
      printWindow.print();
    });
  }
}
