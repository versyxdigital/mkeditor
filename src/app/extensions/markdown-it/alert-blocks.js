import * as container from 'markdown-it-container';

let md;
let containerOpenCount;

const alertBlocks = (instance) => {
    containerOpenCount = 0;
    md = instance;

    init();
};

function init () {
    const alerts = [
        'success',
        'info',
        'warning',
        'danger',
        'primary',
        'secondary',
        'light',
        'dark'
    ];

    for (const alert of alerts) {
        setupContainer(alert);
    }

    setupLinks();
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
