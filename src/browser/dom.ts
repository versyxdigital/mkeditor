import { Tooltip } from 'bootstrap';
import Swal from 'sweetalert2';
import type { FileProperties } from './interfaces/File';
import { getOSPlatform } from './util';
import { t } from './i18n';

let activeTooltips: Tooltip[] = [];

export const dom = {
  splash: <HTMLDivElement>document.querySelector('#splashscreen'),
  // The splash fade-in target. `#app` was the legacy wrapper that React
  // now replaces; the splash overlay fades into `#react-root` instead.
  get app(): HTMLDivElement {
    return document.querySelector('#react-root') as HTMLDivElement;
  },
  get sidebar(): HTMLDivElement {
    return document.querySelector('#sidebar') as HTMLDivElement;
  },
  editor: {
    dom: <HTMLDivElement>document.querySelector('#editor'),
  },
  preview: {
    get wrapper(): HTMLDivElement {
      return document.querySelector('#preview') as HTMLDivElement;
    },
    get dom(): HTMLDivElement {
      return document.querySelector('#preview-content') as HTMLDivElement;
    },
  },
  meta: {
    scroll: {
      line: {
        class: 'has-line-data',
        start: 'data-line-start',
        end: 'data-line-end',
      },
    },
  },
};

export function refreshTooltips() {
  // Dispose existing tooltip instances
  for (const t of activeTooltips) {
    try {
      t.dispose();
    } catch {
      // no-op
    }
  }
  activeTooltips = [];

  const elements: HTMLElement[] = Array.prototype.slice.call(
    document.querySelectorAll('[data-bs-toggle="tooltip"]'),
  );

  for (const el of elements) {
    if (el.dataset.key) {
      if (getOSPlatform() !== 'MacOS') {
        el.title = 'Ctrl + ' + el.dataset.key;
      } else {
        el.title = '⌘ + ' + el.dataset.key;
      }
    }
    activeTooltips.push(new Tooltip(el));
  }
}

export function fade(
  element: HTMLElement,
  direction: 'in' | 'out',
  duration: number,
  callback?: () => void,
) {
  if (direction === 'in') {
    fadeIn(element, duration, callback);
  } else {
    fadeOut(element, duration, callback);
  }
}

export function fadeOut(
  element: HTMLElement,
  duration: number,
  callback?: () => void,
) {
  let alpha = 1;
  const interval = 16; // ~60 FPS
  const decrement = interval / duration;

  const timer = setInterval(() => {
    alpha -= decrement;
    if (alpha <= 0) {
      clearInterval(timer);
      element.style.display = 'none';
      element.style.opacity = '0';
      if (callback) callback();
    } else {
      element.style.opacity = alpha.toString();
    }
  }, interval);
}

export function fadeIn(
  element: HTMLElement,
  duration: number,
  callback?: () => void,
) {
  let alpha = 0;
  element.style.display = '';
  const interval = 16; // ~60 FPS
  const increment = interval / duration;

  const timer = setInterval(() => {
    alpha += increment;
    if (alpha >= 1) {
      clearInterval(timer);
      element.style.opacity = '1';
      if (callback) callback();
    } else {
      element.style.opacity = alpha.toString();
    }
  }, interval);
}

export function showSplashScreen({ duration }: { duration: number }) {
  fade(dom.splash, 'out', duration, () => {
    fade(dom.app, 'in', duration);
    // Reveal the navbars (top + fixed-bottom toolbar) together with the
    // editor. They are siblings of <#splashscreen> in the static HTML, so
    // without this they'd be visible *through* the fading splash and the
    // navbar's left-aligned brand makes the splash content look like it's
    // drifting left during the transition.
    document
      .querySelectorAll<HTMLElement>('body > nav')
      .forEach((nav) => fade(nav, 'in', duration));
  });
}

export function showFilePropertiesWindow(info: FileProperties) {
  const pathType = info.isDirectory
    ? t('modals-properties:type_directory')
    : t('modals-properties:type_file');

  const html = `
    <dl class="mb-0 small text-start">
      <dt class="col-auto fw-semibold me-2">${t('modals-properties:label_path')}</dt>
      <dd class="col-auto me-4">${info.path}</dd>

      <dt class="col-auto fw-semibold me-2">${t('modals-properties:label_type')}</dt>
      <dd class="col-auto me-4">${pathType}</dd>

      <dt class="col-auto fw-semibold me-2">${t('modals-properties:label_size')}</dt>
      <dd class="col-auto me-4">${info.size}</dd>

      <dt class="col-auto fw-semibold me-2">${t('modals-properties:label_created')}</dt>
      <dd class="col-auto me-4">${new Date(info.created).toLocaleString()}</dd>

      <dt class="col-auto fw-semibold me-2">${t('modals-properties:label_modified')}</dt>
      <dd class="col-auto">${new Date(info.modified).toLocaleString()}</dd>
    </dl>
  `;

  Swal.fire({
    html,
    draggable: true,
    customClass: {
      actions: 'mt-0',
      popup: ['shadow', 'rounded'],
    },
    width: 325,
    confirmButtonText: t('modals-properties:close_button'),
  });
}
