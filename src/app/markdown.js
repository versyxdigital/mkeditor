import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import taskLists from './extensions/task-lists';
import alertBlocks from './extensions/alert-blocks';
import tableStyles from './extensions/table-styles';
import lineNumbers from './extensions/line-numbers';

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
