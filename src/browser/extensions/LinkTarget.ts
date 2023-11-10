import MarkdownIt from 'markdown-it';
import { selfRender } from '../util';

const LinkTarget = (md: MarkdownIt) => {
  const render = md.renderer.rules.link_open || selfRender;

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const index = tokens[idx].attrIndex('target');

    if (index < 0) {
      tokens[idx].attrPush(['target', '_blank']);
    } else {
      const attrs = tokens[idx].attrs;
      if (attrs) {
        // Fenced
        let attr = attrs[index][1];
        if (attr) attr = '_blank';
      }
    }

    return render(tokens, idx, options, env, self);
  };
};

export default LinkTarget;
