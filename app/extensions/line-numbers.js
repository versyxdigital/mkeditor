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
        let original = md.renderer.rules[rule]

        md.renderer.rules[rule] = (tokens, idx, options, env, self) => {
            let token = tokens[idx]

            if (token.map && token.map.length) {
                token.attrPush(['class', 'has-line-data'])
            
                if (rule === 'fence') {
                    token.attrPush(['data-line-start', token.map[0] + 1])
                } else {
                    token.attrPush(['data-line-start', token.map[0]])
                }
             
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