let md

const tableStyles = function(instance, options) {
    let defaults = {
        tableClass: [],
    }

    options = Object.assign({}, defaults, options)

    md = instance

    md.renderer.rules.table_open = function (tokens, idx, opts, env, self) {
        let token = tokens[idx]
        
        if (options.tableClass.length > 0) {
            token.attrPush(['class', options.tableClass.join(' ')])
        }

        return self.renderToken(tokens, idx, opts)
    }
}

export default tableStyles