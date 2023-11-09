import hljs from 'highlight.js/lib/core';
import csharp from 'highlight.js/lib/languages/csharp';
import javascript from 'highlight.js/lib/languages/javascript';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import MarkdownIt from 'markdown-it';
import AlertBlock from '../extensions/AlertBlock';
import LineNumber from '../extensions/LineNumber';
import LinkTarget from '../extensions/LinkTarget';
import TableStyle from '../extensions/TableStyle';

hljs.registerLanguage('csharp', csharp);

hljs.registerLanguage('javascript', javascript);
hljs.registerAliases('js', {
  languageName: 'javascript'
});

hljs.registerLanguage('php', php);

hljs.registerLanguage('python', python);
hljs.registerAliases('py', {
  languageName: 'python'
});

hljs.registerLanguage('shell', shell);
hljs.registerAliases('sh', {
  languageName: 'shell'
});

hljs.registerLanguage('sql', sql);
hljs.registerLanguage('xml', xml);

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
          ignoreIllegals: true
        }).value;

        return '<pre class="hljs"><code class="hljs language-' + lang + '">' +
          code +
        '</code></pre>';
      } catch (err) {
        console.log(err);
      }
    }

    return '<pre class="hljs"><code>' + escapeHtml(str) + '</code></pre>';
  }
});


Markdown.use(AlertBlock);
Markdown.use(LineNumber);
Markdown.use(LinkTarget);
Markdown.use(TableStyle);

export {
  Markdown
};
