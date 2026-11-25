import type { MarkdownIt } from 'markdown-it';

const TableStyle = (md: MarkdownIt, options?: any) => {
  const defaults = {
    tableClassList: ['table', 'table-sm', 'table-bordered', 'table-striped'],
  };

  options = { ...defaults, ...options };

  md.renderer.rules.table_open = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    if (options.tableClassList.length > 0) {
      token.attrPush(['class', options.tableClassList.join(' ')]);
    }

    const table = self.renderToken(tokens, idx, opts);
    return env?.scrollableTables
      ? `<div class="assistant-table-scroll" tabindex="0">\n${table}`
      : table;
  };

  const closeTable = md.renderer.rules.table_close;
  md.renderer.rules.table_close = (tokens, idx, opts, env, self) => {
    const table = closeTable
      ? closeTable(tokens, idx, opts, env, self)
      : self.renderToken(tokens, idx, opts);
    return env?.scrollableTables ? `${table}</div>\n` : table;
  };
};

export default TableStyle;
