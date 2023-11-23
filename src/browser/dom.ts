import { editor } from 'monaco-editor/esm/vs/editor/editor.api';
import { Tooltip } from 'bootstrap';
import Split from 'split.js';
import { getOSPlatform } from './util';

export const dom = {
  splash: <HTMLDivElement>document.querySelector('#splashscreen'),
  app: <HTMLDivElement>document.querySelector('#app'),
  about: {
    modal: <HTMLDivElement>document.querySelector('#app-about'),
    version: <HTMLSpanElement>document.querySelector('#app-version')
  },
  shortcuts: {
    modal: <HTMLDivElement>document.querySelector('#app-shortcuts')
  },
  settings: {
    modal: <HTMLDivElement>document.querySelector('#app-settings'),
    autoindent: <HTMLInputElement>document.querySelector('#autoindent-setting'),
    darkmode: <HTMLInputElement>document.querySelector('#darkmode-setting'),
    wordwrap: <HTMLInputElement>document.querySelector('#wordwrap-setting'),
    whitespace: <HTMLInputElement>document.querySelector('#whitespace-setting'),
    minimap: <HTMLInputElement>document.querySelector('#minimap-setting'),
    systemtheme: <HTMLInputElement>document.querySelector('#systemtheme-setting'),
    fileinfo: <HTMLParagraphElement>document.querySelector('#app-settings-file-info')
  },
  icons: {
    darkmode: <HTMLLabelElement>document.querySelector('#darkmode-icon')
  },
  buttons: {
    save: {
      settings: <HTMLButtonElement>document.querySelector('#app-settings-save'),
      markdown: <HTMLButtonElement>document.querySelector('#app-markdown-save'),
      preview: <HTMLButtonElement>document.querySelector('#export-preview-html'),
      styled: <HTMLButtonElement>document.querySelector('#export-preview-styled')
    }
  },
  commands: {
    toolbar: <HTMLDivElement>document.querySelector('#editor-functions'),
    dropdowns: {
      alertblocks: <HTMLDivElement>document.querySelector('#alertblocks'),
      codeblocks: <HTMLDivElement>document.querySelector('#codeblocks'),
    }
  },
  editor: {
    dom: <HTMLDivElement>document.querySelector('#editor')
  },
  preview: {
    dom: <HTMLDivElement>document.querySelector('#preview')
  },
  meta: {
    file: {
      active: <HTMLSpanElement>document.querySelector('#active-file')
    },
    scroll:{
      line: {
        class: 'has-line-data',
        start: 'data-line-start',
        end: 'data-line-end'
      }
    }
  }
};

export async function setupTooltips () {
  [].slice.call(
    document.querySelectorAll('[data-bs-toggle="tooltip"]')
  ).map((tooltip: HTMLElement) => {
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

export function splashScreen() {
  setTimeout(() => fade(dom.splash, 'out'), 750);
  setTimeout(() => fade(dom.app, 'in'), 500);
}

export function fade(element: HTMLElement, direction: 'in' | 'out') {
  direction === 'in' ? fadeIn(element) : fadeOut(element);
}

export function fadeOut(element: HTMLElement) {
  let alpha = 1;
  const timer = setInterval(() => {
    if (alpha <= 0.1){
      clearInterval(timer);
      element.style.display = 'none';
    }
    element.style.opacity = alpha.toString();
    element.style.filter = 'alpha(opacity=' + alpha * 100 + ')';
    alpha -= alpha * 0.1;
  }, 50);
}

export function fadeIn(element: HTMLElement) {
  let alpha = 0.1;
  const timer = setInterval(() => {
    if (alpha >= 1){
      clearInterval(timer);
    }
    element.style.opacity = alpha.toString();
    element.style.filter = 'alpha(opacity=' + alpha * 100 + ')';
    alpha += alpha * 0.1;
  }, 50);
}

export function draggableSplit (model: editor.IStandaloneCodeEditor){
  Split(['#editor-split', '#preview-split'], {
    onDrag () { model.layout(); }
  });
}