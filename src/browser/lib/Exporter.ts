import { formatHTML } from '../util';
import { dom } from '../dom';

const cdn = {
  bootstrap: {
    css: {
      rel: 'stylesheet',
      href: 'https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css',
      integrity:
        'sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC',
      crossorigin: 'anonymous',
    },
    js: {
      src: 'https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js',
      integrity:
        'sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM',
      crossorigin: 'anonymous',
    },
  },
  fontawesome: {
    css: {
      rel: 'stylesheet',
      href: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css',
      integrity:
        'sha512-z3gLpd7yknf1YoNbCzqRKc4qyor8gaKU1qmn+CShxbuBusANI9QpRohGBreCFkKxLhei6S9CQXFEbbKuqLg0DA==',
      crossorigin: 'anonymous',
    },
    js: {
      src: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/js/all.min.js',
      integrity:
        'sha512-uKQ39gEGiyUJl4AI6L+ekBdGKpGw4xJ55+xyJG7YFlJokPNYegn9KwQ3P8A7aFQAUtUsAQHep+d/lrGqrbPIDQ==',
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
};

const css = `@media print {
    .copy-code {
            display: none;
    }
}

.copy-code-pre {
    position: relative;
}

.copy-code-pre code {
    background: #111111 !important;
    color: #c4c4c4;
}

.copy-code {
    display: flex;
    flex-direction: row;
    white-space: normal;
    background: rgba(51, 51, 51, 0.8);
    color: white;
    font-size: 0.875em;
    opacity: 0.5;
    transition: opacity linear 0.5s;
    border-radius: 0 0 0 5px;
    padding: 3px 6px 3px 6px;
    position: absolute;
    right: 0;
    top: 0;
}

.copy-code.active {
    opacity: 0.8;
}

.copy-code:hover {
    opacity: .95;
}

.copy-code a,
.copy-code a:hover {
    text-decoration: none;
}

.copy-code-language {
    margin-right: 10px;
    font-weight: 600;
    color: goldenrod;
}

.copy-code-copy-icon {
    font-size: 1.2em;
    cursor: pointer;
    padding: 0 7px;
    margin-top: 2px;
}

.fa.text-success {
    color: limegreen !important
}

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

export class Exporter {
  /**
   * Generate HTML export.
   *
   * @param content - the editor content
   * @param styled - style the HTML
   * @param providers - style providers
   * @returns - the generated HTML
   */
  static generateExportHTML(
    content: string,
    { styled = true, providers = ['highlightjs'] },
  ) {
    // If using bootstrap styles then wrap the content inside a container with padding
    if (styled && providers.includes('bootstrap')) {
      content = '<div class="container py-5">' + content + '</div>';
    }

    // Create a full HTML document and remove unnecessary attributes and classes
    const document = Exporter.sanitizeHTML(
      new DOMParser().parseFromString(content, 'text/html'),
    );

    if (styled) {
      // Apply styles/scripts based on selected provider(s)
      if (providers) {
        for (const provider of providers) {
          const key = <ProviderKey>provider;
          if (cdn[key]) {
            const { css, js } = cdn[key];

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
      }

      // Custom style for the styled copyable code blocks
      const style = document.createElement('style');
      style.appendChild(document.createTextNode(css));
      document.head.appendChild(style);
    } else {
      // If not using styles then strip all classes
      const elems = document.querySelectorAll('*');
      for (const elem of elems) {
        elem.removeAttribute('class');
      }
    }

    // Beautify the HTML and return it
    return formatHTML(`<!DOCTYPE html>${document.documentElement.outerHTML}`);
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
  static webExportToFile(
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
