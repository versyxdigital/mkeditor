let md

const lineNumbers = (instance) => {
    md = instance

    const lineNumberRendererRuleNames = [
        'paragraph_open',
        'image',
        'code_block',
        'fence',
        'list_item_open'
    ]

    lineNumberRendererRuleNames.forEach((rule) => {
        const original = md.renderer.rules[rule]

        md.renderer.rules[rule] = (tokens, idx, options, env, self) => {
            const token = tokens[idx]
            if (token.map && token.map.length) {
                token.attrPush(['class', 'has-line-data'])

                token.attrPush(['data-line-start', token.map[0] + 1])
                token.attrPush(['data-line-end', token.map[1]])
            }

            if (original) {
                return original(tokens, idx, options, env, self)
            } else {
                return self.renderToken(tokens, idx, options, env, self)
            }
        }
    })
}

export default lineNumbers