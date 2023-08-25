const lineNumbers = (md) => {
    const lineNumberRendererRuleNames = [
        'paragraph_open',
        'image',
        'code_block',
        'fence',
        'list_item_open'
    ];

    lineNumberRendererRuleNames.forEach((rule) => {
        const render = md.renderer.rules[rule] || selfRender;

        md.renderer.rules[rule] = (tokens, idx, options, env, self) => {
            const token = tokens[idx];
            if (token.map && token.map.length) {
                token.attrPush(['class', 'has-line-data']);
                token.attrPush(['data-line-start', token.map[0] + 1]);
                token.attrPush(['data-line-end', token.map[1]]);
            }

            return render(tokens, idx, options, env, self);
        };
    });
};

function selfRender (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options, env, self);
}

export default lineNumbers;
