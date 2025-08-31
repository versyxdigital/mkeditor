import type MarkdownIt from 'markdown-it';
import { selfRender } from '../../util';
import { dom } from '../../dom';

const LineNumber = (md: MarkdownIt) => {
  const rules = [
    'paragraph_open',
    'image',
    'code_block',
    'fence',
    'list_item_open',
  ];

  for (const rule of rules) {
    const render = md.renderer.rules[rule] || selfRender;

    md.renderer.rules[rule] = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      if (token.map && token.map.length) {
        token.attrPush(['class', dom.meta.scroll.line.class]);
        token.attrPush([
          dom.meta.scroll.line.start,
          (token.map[0] + 1).toString(),
        ]);
        token.attrPush([dom.meta.scroll.line.end, token.map[1].toString()]);
      }

      return render(tokens, idx, options, env, self);
    };
  }
};

export default LineNumber;
