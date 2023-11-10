import MarkdownIt, { Token } from 'markdown-it';
import { ContextBridgeAPI } from './interfaces/Bridge';
import Renderer from 'markdown-it/lib/renderer';

export function randomNumber (min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

export function getTimestamp (condense = false) {
  const date = (new Date()).toISOString()
    .slice(0, 19)
    .replace('T', condense ? '' : ' ');

  return condense ? date.replace(/[:-]/g, '') : date;
}

export function formatHTML (html: string) {
  const tab = '\t';
  let result = '';
  let indent = '';

  for (const element of html.split(/>\s*</)) {
    if (element.match(/^\/\w/)) {
      indent = indent.substring(tab.length);
    }

    result += indent + '<' + element + '>\r\n';

    if (element.match(/^<?\w[^>]*[^/]$/) && !element.startsWith('input')) {
      indent += tab;
    }
  }

  return result.substring(1, result.length - 3);
}

export function getExecutionBridge () {
  if (Object.prototype.hasOwnProperty.call(window, 'executionBridge')
  && window.executionBridge !== null) {
    return (window.executionBridge as ContextBridgeAPI);
  }

  return 'web';
}

export function selfRender (
  tokens: Token[],
  idx: number,
  options: MarkdownIt.Options,
  env: any,
  self: Renderer
) {
  return self.renderToken(tokens, idx, options);
}