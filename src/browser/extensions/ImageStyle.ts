import type MarkdownIt from 'markdown-it';

type ImageStyleOptions = {
  imageClassList?: string[];
};

const ImageStyle = (md: MarkdownIt, options: ImageStyleOptions = {}) => {
  const defaults: Required<ImageStyleOptions> = {
    imageClassList: ['img-fluid'],
  };

  const opts = { ...defaults, ...options };

  const defaultRender =
    md.renderer.rules.image ||
    ((tokens, idx, _opts, _env, self) => self.renderToken(tokens, idx, _opts));

  md.renderer.rules.image = (tokens, idx, renderOpts, env, self) => {
    const token = tokens[idx];

    if (opts.imageClassList.length > 0) {
      // Join with any existing classes from other plugins (e.g. attrs)
      token.attrJoin('class', opts.imageClassList.join(' '));
    }

    return defaultRender(tokens, idx, renderOpts, env, self);
  };
};

export default ImageStyle;
