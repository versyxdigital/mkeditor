import type MarkdownIt from 'markdown-it';
import { selfRender } from '../../util';

const LinkTarget = (md: MarkdownIt) => {
  const render = md.renderer.rules.link_open || selfRender;

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const index = tokens[idx].attrIndex('target');

    if (index < 0) {
      tokens[idx].attrPush(['target', '_blank']);
    } else {
      // Override any existing target value with `_blank` so every link
      // opens in a new tab. The previous code reassigned a local
      // variable and never reached the actual attribute.
      const attrs = tokens[idx].attrs;
      if (attrs) attrs[index][1] = '_blank';
    }

    return render(tokens, idx, options, env, self);
  };
};

export default LinkTarget;
