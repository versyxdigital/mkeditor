import type { Options, Token } from 'markdown-it';
import type Renderer from 'markdown-it/lib/renderer.mjs';
import Swal, { type SweetAlertIcon } from 'sweetalert2';
import type { ContextBridgeAPI } from './interfaces/Bridge';
import type { ExportSettings } from './interfaces/Editor';

/**
 * Debounce to delay execution.
 *
 * @param fn 
 * @param wait 
 * @returns 
 */
export function debounce<F extends (...args: any[]) => void>(fn: F, wait: number) {
  let timeout: number | null = null;
  return (...args: Parameters<F>) => {
    if (timeout) {
      window.clearTimeout(timeout);
    }

    timeout = window.setTimeout(() => {
      timeout = null;
      fn(...args);
    }, wait);
  };
};

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
  options: Options,
  env: any,
  self: Renderer,
) {
  return self.renderToken(tokens, idx, options);
}

/**
 * Return a filename with .md extension.
 *
 * @param name - the file name
 * @returns
 */
export function withMdExtension(name: string) {
  let filename = name.trim();
  if (!filename.toLowerCase().endsWith('.md')) {
    filename += '.md';
  }

  return filename;
}

/**
 * Set the preview style based on export settings.
 *
 * @param settings - the export settings.
 * @param elem - the preview element.
 */
export function syncPreviewToExportSettings(
  settings: ExportSettings,
  elem: HTMLElement,
) {
  elem.classList.remove('container', 'container-fluid');

  if (settings.withStyles) {
    elem.classList.add(settings.container);
  }

  elem.style.fontSize = `${settings.fontSize}px`;
  elem.style.lineHeight = settings.lineSpacing.toString();
}

/**
 * Configure a sweetalert2 mixin for toast notifications.
 */
const toast: ReturnType<typeof Swal.mixin> = Swal.mixin({
  toast: true,
  position: 'bottom-end',
  showConfirmButton: false,
  showCloseButton: true,
  timer: 7500,
  timerProgressBar: true,
  showClass: {
    popup: '',
  },
  hideClass: {
    popup: '',
  },
  didOpen: (toast) => {
    toast.addEventListener('mouseenter', Swal.stopTimer);
    toast.addEventListener('mouseleave', Swal.resumeTimer);
  },
});

export const notify = {
  /**
   * Send a toast notification.
   *
   * @param icon - the icon for the notification
   * @param html - the content of the notification
   */
  async send(icon: string, html: string) {
    const title = icon.charAt(0).toUpperCase() + icon.slice(1);
    await toast.fire({ html, title, icon: icon as SweetAlertIcon });
  },
};
