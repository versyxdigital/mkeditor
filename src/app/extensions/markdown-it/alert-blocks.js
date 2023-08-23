const container = require('markdown-it-container');

let md;
let links;
let containerOpenCount;

const alertBlocks = function (instance, options) {
    containerOpenCount = 0;
    links = options ? options.links : true;
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

    if (links) {
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

    md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
        if (isContainerOpen()) {
            tokens[idx].attrPush(['class', 'alert-link']);
        }

        return render(tokens, idx, options, env, self);
    };
}

function isContainerOpen () {
    return containerOpenCount > 0;
}

function selfRender (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
}

export default alertBlocks;
