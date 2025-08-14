jest.mock('../src/browser/assets/intro', () => ({
  welcomeMarkdown: '# Welcome',
}));
import { editor as monacoEditor } from 'monaco-editor/esm/vs/editor/editor.api';

let Editor: any;
let EditorDispatcher: any;

describe('Editor', () => {
  beforeEach(async () => {
    document.body.innerHTML = `
      <div id="editor"></div>
      <div id="preview"></div>
      <div id="app-about"><span id="app-version"></span></div>
    `;
    ({ Editor } = await import('../src/browser/lib/Editor'));
    ({ EditorDispatcher } = await import(
      '../src/browser/events/EditorDispatcher'
    ));
  });

  it('creates editor with correct parameters', () => {
    const dispatcher = new EditorDispatcher();
    const mkeditor = new Editor('web', dispatcher);
    mkeditor.create({ watch: false });

    expect(monacoEditor.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        value: '# Welcome',
        language: 'markdown',
        wordWrap: 'on',
      }),
    );

    expect(mkeditor.getModel()).not.toBeNull();
  });
});
