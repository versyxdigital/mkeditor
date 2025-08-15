import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { Tooltip } from 'bootstrap';
import Split from 'split.js';
import { getOSPlatform } from './util';

export const dom = {
  splash: <HTMLDivElement>document.querySelector('#splashscreen'),
  app: <HTMLDivElement>document.querySelector('#app'),
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
    fileinfo: <HTMLParagraphElement>(
      document.querySelector('#app-settings-file-info')
    ),
  },
  icons: {
    darkmode: <HTMLLabelElement>document.querySelector('#darkmode-icon'),
  },
  buttons: {
    sidebar: <HTMLButtonElement>document.querySelector('#sidebar-toggle'),
    save: {
      settings: <HTMLButtonElement>document.querySelector('#app-settings-save'),
      markdown: <HTMLButtonElement>document.querySelector('#app-markdown-save'),
      preview: <HTMLButtonElement>(
        document.querySelector('#export-preview-html')
      ),
      styled: <HTMLButtonElement>(
        document.querySelector('#export-preview-styled')
      ),
    },
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
    dom: <HTMLDivElement>document.querySelector('#preview'),
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

export async function setupTooltips() {
  [].slice
    .call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
    .map((tooltip: HTMLElement) => {
      if (tooltip.dataset.key) {
        if (getOSPlatform() !== 'MacOS') {
          tooltip.title = 'Ctrl + ' + tooltip.dataset.key;
        } else {
          tooltip.title = '⌘ + ' + tooltip.dataset.key;
        }
      }
      return new Tooltip(tooltip);
    });
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
  model: editor.IStandaloneCodeEditor,
) {
  Split(['#editor-split', '#preview-split'], {
    minSize: 0,
    onDrag() {
      model.layout();
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
      model.layout();
    },
  });
}

// Toggle sidebar visibility.
export function createSidebarToggle(model: editor.IStandaloneCodeEditor) {
  const sidebarGutter = document.querySelector(
    '.gutter.sidebar-gutter-horizontal',
  ) as HTMLDivElement | null;

  dom.buttons.sidebar?.addEventListener('click', () => {
    const hidden = dom.sidebar.style.display === 'none';
    if (hidden) {
      dom.sidebar.style.display = '';
      if (sidebarGutter) sidebarGutter.style.display = '';
    } else {
      dom.sidebar.style.display = 'none';
      if (sidebarGutter) sidebarGutter.style.display = 'none';
    }

    model.layout();
  });
}
