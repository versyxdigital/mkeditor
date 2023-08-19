import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import csharp from 'highlight.js/lib/languages/csharp';
import xml from 'highlight.js/lib/languages/xml';
import MarkdownIt from 'markdown-it';
import taskLists from './extensions/task-lists';
import alertBlocks from './extensions/alert-blocks';
import tableStyles from './extensions/table-styles';
import lineNumbers from './extensions/line-numbers';

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
    highlight: (str, lang) => {
        const escape = md.utils.escapeHtml;
        if (lang && hljs.getLanguage(lang)) {
            try {
                return '<pre class="hljs"><code class="hljs language-' + lang + '">' +
                hljs.highlight(lang, str, {
                    ignoreIllegals: true
                }).value +
                '</code></pre>';
            } catch (__) {}
        } else {
            return '<pre class="hljs"><code>' + escape(str) + '</code></pre>';
        }
    }
});

md.use(alertBlocks);
md.use(lineNumbers);
md.use(taskLists, { labelClass: 'ml-2' });
md.use(tableStyles, { tableClass: ['table', 'table-sm', 'table-bordered', 'table-striped'] });

export default md;
