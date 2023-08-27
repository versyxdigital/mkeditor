import * as container from 'markdown-it-container';

let md;
let hasLinks;
let containerOpenCount;

const alertBlocks = (instance, options) => {
    containerOpenCount = 0;
    hasLinks = options ? options.links : true;
    md = instance;

    init();
};

function init () {
    setupContainer('success');
    setupContainer('info');
    setupContainer('warning');
    setupContainer('danger');
    setupContainer('primary');
    setupContainer('secondary');
    setupContainer('light');
    setupContainer('dark');

    if (hasLinks) {
        setupLinks();
    }
}

function setupContainer (name) {
    md.use(container, name, {
        render: function (tokens, idx) {
            if (tokens[idx].nesting === 1) {
                containerOpenCount += 1;
                return `<div class="alert alert-${name}" role="alert">\n`;
            } else {
                containerOpenCount -= 1;
                return '</div>\n';
            }
        }
    });
}

function setupLinks () {
    const render = md.renderer.rules.link_open || selfRender;

    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        if (containerOpenCount > 0) {
            tokens[idx].attrPush(['class', 'alert-link']);
        }

        return render(tokens, idx, options, env, self);
    };
}

function selfRender (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
}

export default alertBlocks;
