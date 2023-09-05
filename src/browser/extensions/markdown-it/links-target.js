const linksTarget = (md) => {
    const render = md.renderer.rules.link_open || selfRender;

    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const index = tokens[idx].attrIndex('target');

        if (index < 0) {
            tokens[idx].attrPush(['target', '_blank']);
        } else {
            tokens[idx].attrs[index][1] = '_blank';
        }

        return render(tokens, idx, options, env, self);
    };
};

function selfRender (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
};

export default linksTarget;
