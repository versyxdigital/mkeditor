import { dom } from '../dom';
import { ExportSettings } from '../interfaces/Editor';

const cdn = {
  bootstrap: {
    css: {
      rel: 'stylesheet',
      href: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
      integrity:
        'sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH',
      crossorigin: 'anonymous',
    },
    js: {
      src: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.min.js',
      integrity:
        'sha384-0pUGZvbkm6XF6gxjEnlmuGrJXVbNuzT9qBBavbLwCsOGabYfZo0T0to5eqruptLy',
      crossorigin: 'anonymous',
    },
  },
  fontawesome: {
    css: {
      rel: 'stylesheet',
      href: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.0/css/all.min.css',
      integrity:
        'sha512-DxV+EoADOkOygM4IR9yXP8Sb2qwgidEmeqAEmDKIOfPRQZOWbXCzLC6vjbZyy0vPisbH2SyW27+ddLVCN+OMzQ==',
      crossorigin: 'anonymous',
    },
    js: {
      src: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.0/js/all.min.js',
      integrity:
        'sha512-gBYquPLlR76UWqCwD06/xwal4so02RjIR0oyG1TIhSGwmBTRrIkQbaPehPF8iwuY9jFikDHMGEelt0DtY7jtvQ==',
      crossorigin: 'anonymous',
    },
  },
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

const inlineCSS = `@media print {
.hljs-meta .hljs-string, .hljs-regexp, .hljs-string {
    color: #f7a857;
}

.hljs-attr,
.hljs-attribute,
.hljs-literal,
.hljs-meta,
.hljs-number,
.hljs-operator,
.hljs-selector-attr,
.hljs-selector-class,
.hljs-selector-id,
.hljs-variable {
    color: #78c9e8;
}

.hljs-title,
.hljs-title.class_,
.hljs-title.class_.inherited__,
.hljs-title.function_ {
    color: #ccda59;
}
`;

type ProviderKey = keyof typeof cdn;

const providers: ProviderKey[] = [
  'bootstrap',
  'fontawesome',
  'highlightjs',
  'katex',
];

export class HTMLExporter {
  /**
   * Generate HTML export.
   *
   * @param content - the editor content
   * @param styled - flag to determine whether to style the HTML
   * @returns - the generated HTML
   */
  static generateHTML(
    content: string,
    {
      withStyles = true,
      container = 'container-fluid',
      fontSize = 16,
      lineSpacing = 1.5,
      background = '#ffffff',
      fontColor = '#000000',
    }: ExportSettings,
  ) {
    // If using bootstrap styles then wrap the content inside a container with padding
    if (withStyles) {
      content = `<div class="${container} py-5" style="background: ${background}">${content.trim()}</div>`;
    }

    // Create a full HTML document and remove unnecessary attributes and classes
    const document = HTMLExporter.sanitizeHTML(
      new DOMParser().parseFromString(content.trim(), 'text/html'),
    );

    if (withStyles) {
      // Apply styles/scripts based on selected provider(s)
      for (const provides of providers) {
        if (cdn[provides]) {
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
      }

      // Custom styling
      const style = document.createElement('style');
      style.appendChild(document.createTextNode(inlineCSS));
      document.head.appendChild(style);

      // User settings
      document.body.style.fontSize = `${fontSize}px`;
      document.body.style.lineHeight = lineSpacing.toString();
      document.body.style.backgroundColor = background;
      document.body.style.color = fontColor;
    } else {
      // If not using styles then strip all classes
      const elems = document.querySelectorAll('*');
      for (const elem of elems) {
        elem.removeAttribute('class');
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
  static exportHTML(
    content: string,
    mimeType: MIMEType = 'text/plain',
    extension: FileExtension = '.md',
  ) {
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
}
