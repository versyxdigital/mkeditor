const tableStyles = (md, options) => {
    const defaults = {
        tableClassList: []
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

export default tableStyles;
