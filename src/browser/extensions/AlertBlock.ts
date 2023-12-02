import MarkdownIt from 'markdown-it';
import MarkdownItContainer from 'markdown-it-container';
import { selfRender } from '../util';

let handler: MarkdownIt;
let containerOpenCount: number;

const AlertBlock = (md: MarkdownIt) => {
  containerOpenCount = 0;
  handler = md;
  setup();
};

function setup() {
  const alerts = [
    'success',
    'info',
    'warning',
    'danger',
    'primary',
    'secondary',
    'light',
    'dark',
  ];

  for (const alert of alerts) {
    container(alert);
  }

  links();
}

function container(name: string) {
  handler.use(MarkdownItContainer, name, {
    render: function (tokens: any, i: number) {
      if (tokens[i].nesting === 1) {
        containerOpenCount += 1;
        return `<div class="alert alert-${name}" role="alert">\n`;
      } else {
        containerOpenCount -= 1;
        return '</div>\n';
      }
    },
  });
}

function links() {
  const render = handler.renderer.rules.link_open || selfRender;

  handler.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    if (containerOpenCount > 0) {
      tokens[idx].attrPush(['class', 'alert-link']);
    }

    return render(tokens, idx, options, env, self);
  };
}

export default AlertBlock;
