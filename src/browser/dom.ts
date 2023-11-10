export const dom = {
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
    }
  }
};