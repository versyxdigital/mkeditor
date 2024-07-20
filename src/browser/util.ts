import MarkdownIt, { Token } from 'markdown-it';
import { ContextBridgeAPI } from './interfaces/Bridge';
import Renderer from 'markdown-it/lib/renderer.mjs';

/**
 * Generate a random number between two numbers.
 *
 * @param min - the minimum number to generate
 * @param max - the maximum number to generate
 * @returns
 */
export function randomNumber(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Get a timestamp.
 *
 * @param condense
 * @returns
 */
export function getTimestamp(condense = false) {
  const date = new Date()
    .toISOString()
    .slice(0, 19)
    .replace('T', condense ? '' : ' ');

  return condense ? date.replace(/[:-]/g, '') : date;
}

/**
 * Format HTML
 * @param html - the HTML string to format
 * @returns - formatted HTML string
 */
export function formatHTML(html: string) {
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

/**
 * Get the operating system based on the user agent.
 *
 * @returns - the operating system
 */
export function getOSPlatform() {
  const { userAgent } = window.navigator;
  if (userAgent.indexOf('Win') != -1) return 'Windows';
  if (userAgent.indexOf('Mac') != -1) return 'MacOS';
  if (userAgent.indexOf('Linux') != -1) return 'Linux';
}

/**
 * Get the context execution bridge.
 *
 * @returns - the execution bridge.
 */
export function getExecutionBridge() {
  if (
    Object.prototype.hasOwnProperty.call(window, 'executionBridge') &&
    window.executionBridge !== null
  ) {
    return window.executionBridge as ContextBridgeAPI;
  }

  return 'web';
}

/**
 * Self render callback shared by all markdown extensions.
 */
export function selfRender(
  tokens: Token[],
  idx: number,
  options: MarkdownIt.Options,
  env: any,
  self: Renderer,
) {
  return self.renderToken(tokens, idx, options);
}
