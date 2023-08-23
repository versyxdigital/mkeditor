const tableStyles = function (md, options) {
    const defaults = {
        tableClass: []
    };

    options = Object.assign({}, defaults, options);

    md.renderer.rules.table_open = function (tokens, idx, opts, env, self) {
        const token = tokens[idx];
        if (options.tableClass.length > 0) {
            token.attrPush(['class', options.tableClass.join(' ')]);
        }

        return self.renderToken(tokens, idx, opts);
    };
};

export default tableStyles;
