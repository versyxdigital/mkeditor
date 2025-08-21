jest.mock('../src/browser/assets/intro', () => ({
  welcomeMarkdown: '# Welcome',
}));
import { editor as monacoEditor } from 'monaco-editor/esm/vs/editor/editor.api';

let EditorManager: any;
let EditorDispatcher: any;

describe('Editor', () => {
  beforeEach(async () => {
    document.body.innerHTML = `
      <div id="editor"></div>
      <div id="preview"></div>
      <div id="app-about"><span id="app-version"></span></div>
      <span id="app-build-id"></span>
    `;
    ({ EditorManager } = await import('../src/browser/core/EditorManager'));
    ({ EditorDispatcher } = await import(
      '../src/browser/events/EditorDispatcher'
    ));
  });

  it('creates editor with correct parameters', () => {
    const dispatcher = new EditorDispatcher();
    const mkeditor = new EditorManager({
      dispatcher,
      init: true,
      watch: false,
    });

    expect(monacoEditor.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        value: '# Welcome',
        language: 'markdown',
        wordWrap: 'on',
      }),
    );

    expect(mkeditor.getMkEditor()).not.toBeNull();
  });
});
