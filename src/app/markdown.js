import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import csharp from 'highlight.js/lib/languages/csharp';
import xml from 'highlight.js/lib/languages/xml';
import MarkdownIt from 'markdown-it';
import alertBlocks from './extensions/markdown-it/alert-blocks';
import lineNumbers from './extensions/markdown-it/line-numbers';
import tableStyles from './extensions/markdown-it/table-styles';
import taskLists from './extensions/markdown-it/task-lists';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('sh', shell);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('xml', xml);

const md = new MarkdownIt({
    code: false,
    breaks: true,
    linkify: true,
    highlight: (content, language) => {
        const { escapeHtml } = md.utils;
        if (language && hljs.getLanguage(language)) {
            try {
                const code = hljs.highlight(content, {
                    language,
                    ignoreIllegals: true
                }).value;

                return '<pre class="hljs"><code class="hljs language-' + language + '">' +
                    code +
                '</code></pre>';
            } catch (__) {}
        } else {
            return '<pre class="hljs"><code>' + escapeHtml(content) + '</code></pre>';
        }
    }
});

md.use(alertBlocks);
md.use(lineNumbers);
md.use(taskLists, { labelClass: 'ml-2' });
md.use(tableStyles, { tableClass: ['table', 'table-sm', 'table-bordered', 'table-striped'] });

export default md;
