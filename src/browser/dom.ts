import type { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { Tooltip } from 'bootstrap';
import Split from 'split.js';
import Swal from 'sweetalert2';
import type { FileProperties } from './interfaces/File';
import { getOSPlatform } from './util';
import { t } from './i18n';

let editorPreviewSplit: Split.Instance | null = null;
let activeTooltips: Tooltip[] = [];

export const dom = {
  splash: <HTMLDivElement>document.querySelector('#splashscreen'),
  app: <HTMLDivElement>document.querySelector('#app'),
  build: <HTMLSpanElement>document.querySelector('#app-build-id'),
  sidebar: <HTMLDivElement>document.querySelector('#sidebar'),
  about: {
    modal: <HTMLDivElement>document.querySelector('#app-about'),
    version: <HTMLSpanElement>document.querySelector('#app-version'),
  },
  shortcuts: {
    modal: <HTMLDivElement>document.querySelector('#app-shortcuts'),
  },
  settings: {
    modal: <HTMLDivElement>document.querySelector('#app-settings'),
    autoindent: <HTMLInputElement>document.querySelector('#autoindent-setting'),
    darkmode: <HTMLInputElement>document.querySelector('#darkmode-setting'),
    wordwrap: <HTMLInputElement>document.querySelector('#wordwrap-setting'),
    whitespace: <HTMLInputElement>document.querySelector('#whitespace-setting'),
    minimap: <HTMLInputElement>document.querySelector('#minimap-setting'),
    systemtheme: <HTMLInputElement>(
      document.querySelector('#systemtheme-setting')
    ),
    scrollsync: <HTMLInputElement>document.querySelector('#scrollsync-setting'),
    locale: <HTMLSelectElement>document.querySelector('#locale-setting'),
    fileinfo: <HTMLParagraphElement>(
      document.querySelector('#app-settings-file-info')
    ),
  },
  exports: {
    modal: <HTMLDivElement>document.querySelector('#export-settings'),
    withStyles: <HTMLInputElement>document.querySelector('#export-with-styles'),
    container: <HTMLSelectElement>(
      document.querySelector('#export-setting-container')
    ),
    fontSize: <HTMLInputElement>(
      document.querySelector('#export-setting-fontsize')
    ),
    lineSpacing: <HTMLInputElement>(
      document.querySelector('#export-setting-linespacing')
    ),
    background: <HTMLInputElement>(
      document.querySelector('#export-setting-background')
    ),
    fontColor: <HTMLInputElement>(
      document.querySelector('#export-setting-font-color')
    ),
  },
  icons: {
    darkmode: <HTMLLabelElement>document.querySelector('#darkmode-icon'),
  },
  buttons: {
    sidebar: <HTMLButtonElement>document.querySelector('#sidebar-toggle'),
    settings: <HTMLElement>(
      document.querySelector('[data-bs-target="#app-settings"]')
    ),
    save: {
      settings: <HTMLButtonElement>document.querySelector('#app-settings-save'),
      exportSettings: <HTMLButtonElement>(
        document.querySelector('#export-settings-save')
      ),
      markdown: <HTMLButtonElement>document.querySelector('#app-markdown-save'),
      html: <HTMLButtonElement>document.querySelector('#export-to-html'),
      pdf: <HTMLButtonElement>document.querySelector('#export-to-pdf'),
      styled: <HTMLButtonElement>document.querySelector('#export-with-styles'),
    },
    delete: <HTMLButtonElement>document.querySelector('#app-markdown-delete'),
    resetSplit: <HTMLButtonElement>document.querySelector('#split-reset'),
    resetExportSettings: <HTMLButtonElement>(
      document.querySelector('#export-settings-reset')
    ),
  },
  commands: {
    toolbar: <HTMLDivElement>document.querySelector('#editor-functions'),
    dropdowns: {
      alertblocks: <HTMLDivElement>document.querySelector('#alertblocks'),
      codeblocks: <HTMLDivElement>document.querySelector('#codeblocks'),
      tables: <HTMLDivElement>document.querySelector('#markdown-tables'),
    },
    forms: {
      tables: {
        cols: <HTMLInputElement>document.querySelector('#markdown-table-cols'),
        rows: <HTMLInputElement>document.querySelector('#markdown-table-rows'),
        submit: <HTMLButtonElement>(
          document.querySelector('#insert-markdown-table-btn')
        ),
      },
    },
  },
  editor: {
    dom: <HTMLDivElement>document.querySelector('#editor'),
  },
  preview: {
    wrapper: <HTMLDivElement>document.querySelector('#preview'),
    dom: <HTMLDivElement>document.querySelector('#preview-content'),
  },
  tabs: <HTMLUListElement>document.querySelector('#editor-tabs'),
  filetree: <HTMLUListElement>document.querySelector('#file-tree'),
  meta: {
    file: {
      active: <HTMLSpanElement>document.querySelector('#active-file'),
    },
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
  });
}

export function createDraggableSplitPanels(
  mkeditor: editor.IStandaloneCodeEditor,
) {
  editorPreviewSplit = Split(['#editor-split', '#preview-split'], {
    minSize: 0,
    onDrag() {
      mkeditor.layout();
    },
  });

  Split(['#sidebar', '#wrapper'], {
    sizes: [15, 85],
    gutter(index, direction) {
      const gutter = document.createElement('div');
      gutter.className = `gutter sidebar-gutter-${direction}`;
      return gutter;
    },
    gutterStyle: () => ({
      width: '3px',
    }),
    onDrag() {
      mkeditor.layout();
    },
  });
}

export function resetEditorPreviewSplit(
  mkeditor: editor.IStandaloneCodeEditor,
) {
  editorPreviewSplit?.setSizes([50, 50]);
  mkeditor.layout();
}

// Toggle sidebar visibility.
export function createSidebarToggle(mkeditor: editor.IStandaloneCodeEditor) {
  const sidebarGutter = document.querySelector(
    '.gutter.sidebar-gutter-horizontal',
  ) as HTMLDivElement | null;

  dom.buttons.sidebar?.addEventListener('click', () => {
    const isHidden = dom.sidebar.classList.toggle('d-none');
    dom.sidebar.classList.toggle('d-flex', !isHidden);
    if (sidebarGutter) sidebarGutter.hidden = isHidden;

    mkeditor.layout();
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
