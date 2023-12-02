import MarkdownIt from 'markdown-it';

const TableStyle = (md: MarkdownIt, options: any) => {
  const defaults = {
    tableClassList: ['table', 'table-sm', 'table-bordered', 'table-striped'],
  };

  options = { ...defaults, ...options };

  md.renderer.rules.table_open = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    if (options.tableClassList.length > 0) {
      token.attrPush(['class', options.tableClassList.join(' ')]);
    }

    return self.renderToken(tokens, idx, opts);
  };
};

export default TableStyle;
