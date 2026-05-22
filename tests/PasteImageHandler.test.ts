/**
 * PasteImageHandler — clipboard paste → IPC → markdown insertion.
 *
 * Exercises the renderer-side handler in isolation: the writer is a
 * jest mock so neither Electron nor the File System Access API is
 * needed. ClipboardEvent / DataTransfer is constructed by jsdom.
 */

import {
  PasteImageHandler,
  relativePath,
} from '../src/browser/core/PasteImageHandler';

jest.mock('../src/browser/notify', () => ({
  sonnerToast: jest.fn(),
}));

jest.mock('../src/browser/i18n', () => ({
  // Predictable translation: return the key (so `t('foo')` is `'foo'`).
  t: jest.fn((key: string) => key),
}));

/** Build the minimal Monaco surface PasteImageHandler touches. */
function makeFakeEditor(opts: { container?: HTMLElement } = {}) {
  const container = opts.container ?? document.createElement('div');
  // Add an inner child so the test paste target can be set to
  // something contained by the editor — matches Monaco's real DOM
  // where paste events actually fire on the inner `.inputarea`
  // textarea, not the outermost wrapper.
  const inner = document.createElement('textarea');
  container.appendChild(inner);
  document.body.appendChild(container);
  const selection = {
    startLineNumber: 3,
    startColumn: 5,
    endLineNumber: 3,
    endColumn: 5,
  };
  const setSelection = jest.fn();
  const executeEdits = jest.fn();
  const focus = jest.fn();
  let textFocus = true;
  return {
    container,
    inner,
    selection,
    setSelection,
    executeEdits,
    focus,
    setTextFocus: (v: boolean) => {
      textFocus = v;
    },
    api: {
      getDomNode: jest.fn(() => container),
      getSelection: jest.fn(() => selection),
      executeEdits,
      setSelection,
      focus,
      hasTextFocus: jest.fn(() => textFocus),
    } as never,
  };
}

function makeFakeFileManager(activePath: string | null) {
  return {
    getActiveEditablePath: jest.fn(() => activePath),
  } as never;
}

function makeFakeSettingsProvider(directory = './assets') {
  return {
    getSetting: jest.fn((key: string) => {
      if (key === 'pasteImages') return { directory };
      return undefined;
    }),
  } as never;
}

/**
 * Dispatch a synthetic paste event with a single image item on the
 * editor's inner element (matching how a real Ctrl+V fires on
 * Monaco's `.inputarea`). The handler listens on `window` with
 * capture: true, so as long as the event bubbles up through the
 * editor container we'll see it.
 *
 * jsdom doesn't fully implement DataTransfer, so we shape the event
 * manually with the fields PasteImageHandler reads.
 */
function dispatchPaste(
  inner: HTMLElement,
  items: Array<{ kind: string; type: string; file: File | null }>,
): { preventedDefault: boolean } {
  const clipboardData = {
    items: items.map((it) => ({
      kind: it.kind,
      type: it.type,
      getAsFile: () => it.file,
    })),
  };
  let preventedDefault = false;
  const event = Object.assign(new Event('paste', { bubbles: true }), {
    clipboardData,
    preventDefault: () => {
      preventedDefault = true;
    },
    stopPropagation: () => {},
  });
  inner.dispatchEvent(event as never);
  return { preventedDefault };
}

/**
 * PNG fake: tiny ArrayBuffer with deterministic bytes. jsdom's `File`
 * doesn't implement `arrayBuffer()`, so we shim it onto the instance
 * — PasteImageHandler awaits this method to extract clipboard bytes.
 */
function pngFile(bytes = [0x89, 0x50, 0x4e, 0x47]): File {
  const file = new File([new Uint8Array(bytes)], 'cb.png', {
    type: 'image/png',
  });
  const buffer = new Uint8Array(bytes).buffer;
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => buffer,
    configurable: true,
  });
  return file;
}

/* -------------------------------------------------------------------- */
/*  relativePath helper                                                  */
/* -------------------------------------------------------------------- */

describe('relativePath', () => {
  it('builds a sibling path with the markdown ./-prefix convention', () => {
    expect(relativePath('C:/work', 'C:/work/cover.png')).toBe('./cover.png');
  });

  it('walks down into subfolders', () => {
    expect(relativePath('C:/work', 'C:/work/assets/cover.png')).toBe(
      './assets/cover.png',
    );
  });

  it('walks up with .. when the target sits above fromDir', () => {
    expect(relativePath('C:/work/notes/sub', 'C:/work/assets/cover.png')).toBe(
      '../../assets/cover.png',
    );
  });

  it('case-insensitive on Windows drive letters', () => {
    expect(relativePath('c:/work', 'C:/work/cover.png')).toBe('./cover.png');
  });

  it('normalises backslashes to forward slashes', () => {
    expect(
      relativePath('C:\\work\\notes', 'C:\\work\\notes\\assets\\cover.png'),
    ).toBe('./assets/cover.png');
  });

  it('handles a POSIX path pair', () => {
    expect(
      relativePath('/home/chris/notes', '/home/chris/notes/cover.png'),
    ).toBe('./cover.png');
  });
});

/* -------------------------------------------------------------------- */
/*  PasteImageHandler — clipboard intake                                  */
/* -------------------------------------------------------------------- */

describe('PasteImageHandler', () => {
  // Window-level listeners persist across tests unless explicitly
  // removed; track every `attach()` so the afterEach can detach
  // them and stop a prior test's writer mock from intercepting a
  // later test's dispatched event.
  const cleanups: Array<() => void> = [];
  const attachAndTrack = (handler: PasteImageHandler) => {
    const detach = handler.attach();
    cleanups.push(detach);
    return detach;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      try {
        fn?.();
      } catch {
        // detach is best-effort during teardown
      }
    }
  });

  it('ignores a paste that carries no image items (falls through to default)', () => {
    const ed = makeFakeEditor();
    const writer = jest.fn();
    const handler = new PasteImageHandler(
      ed.api,
      makeFakeFileManager('/work/readme.md'),
      makeFakeSettingsProvider(),
      writer,
    );
    attachAndTrack(handler);
    const { preventedDefault } = dispatchPaste(ed.inner, [
      { kind: 'string', type: 'text/plain', file: null },
    ]);
    expect(preventedDefault).toBe(false);
    expect(writer).not.toHaveBeenCalled();
  });

  it('calls the writer with normalised bytes + extension for an image paste', async () => {
    const ed = makeFakeEditor();
    const writer = jest.fn().mockResolvedValue({
      ok: true,
      path: '/work/assets/img_20260522120000.png',
    });
    const handler = new PasteImageHandler(
      ed.api,
      makeFakeFileManager('/work/readme.md'),
      makeFakeSettingsProvider('./assets'),
      writer,
    );
    attachAndTrack(handler);
    const { preventedDefault } = dispatchPaste(ed.inner, [
      { kind: 'file', type: 'image/png', file: pngFile() },
    ]);
    expect(preventedDefault).toBe(true);
    // The handler is async — drain microtasks.
    await new Promise((r) => setTimeout(r, 0));
    expect(writer).toHaveBeenCalledTimes(1);
    const call = writer.mock.calls[0][0];
    expect(call.sourceFile).toBe('/work/readme.md');
    expect(call.directory).toBe('./assets');
    expect(call.extension).toBe('png');
    expect(call.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(call.bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('inserts a relative markdown link at the cursor after a successful write', async () => {
    const ed = makeFakeEditor();
    const writer = jest.fn().mockResolvedValue({
      ok: true,
      path: '/work/assets/img_20260522120000.png',
    });
    const handler = new PasteImageHandler(
      ed.api,
      makeFakeFileManager('/work/readme.md'),
      makeFakeSettingsProvider('./assets'),
      writer,
    );
    attachAndTrack(handler);
    dispatchPaste(ed.inner, [
      { kind: 'file', type: 'image/png', file: pngFile() },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(ed.executeEdits).toHaveBeenCalledTimes(1);
    const [, edits] = ed.executeEdits.mock.calls[0];
    expect(edits[0].text).toBe('![](./assets/img_20260522120000.png)');
    expect(edits[0].range).toEqual(ed.selection);
  });

  it('refuses to write when no editable file is open and shows a toast', async () => {
    const ed = makeFakeEditor();
    const writer = jest.fn();
    const { sonnerToast } = require('../src/browser/notify');
    const handler = new PasteImageHandler(
      ed.api,
      makeFakeFileManager(null),
      makeFakeSettingsProvider(),
      writer,
    );
    attachAndTrack(handler);
    dispatchPaste(ed.inner, [
      { kind: 'file', type: 'image/png', file: pngFile() },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(writer).not.toHaveBeenCalled();
    expect(sonnerToast).toHaveBeenCalledWith(
      'warning',
      'notifications:pasted_image_no_workspace',
    );
    expect(ed.executeEdits).not.toHaveBeenCalled();
  });

  it('shows an error toast and skips insertion when the writer rejects', async () => {
    const ed = makeFakeEditor();
    const writer = jest.fn().mockResolvedValue({
      ok: false,
      error: 'EACCES: permission denied',
    });
    const { sonnerToast } = require('../src/browser/notify');
    const handler = new PasteImageHandler(
      ed.api,
      makeFakeFileManager('/work/readme.md'),
      makeFakeSettingsProvider(),
      writer,
    );
    attachAndTrack(handler);
    dispatchPaste(ed.inner, [
      { kind: 'file', type: 'image/png', file: pngFile() },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(ed.executeEdits).not.toHaveBeenCalled();
    expect(sonnerToast).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('EACCES'),
    );
  });

  it('handles multiple images in a single paste, one insertion each', async () => {
    const ed = makeFakeEditor();
    const writer = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, path: '/work/assets/a.png' })
      .mockResolvedValueOnce({ ok: true, path: '/work/assets/b.png' });
    const handler = new PasteImageHandler(
      ed.api,
      makeFakeFileManager('/work/readme.md'),
      makeFakeSettingsProvider('./assets'),
      writer,
    );
    attachAndTrack(handler);
    dispatchPaste(ed.inner, [
      { kind: 'file', type: 'image/png', file: pngFile([1, 2, 3]) },
      { kind: 'file', type: 'image/png', file: pngFile([4, 5, 6]) },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(writer).toHaveBeenCalledTimes(2);
    expect(ed.executeEdits).toHaveBeenCalledTimes(2);
  });

  it('detach() unbinds the paste listener', async () => {
    const ed = makeFakeEditor();
    const writer = jest.fn().mockResolvedValue({ ok: true, path: '/x.png' });
    const handler = new PasteImageHandler(
      ed.api,
      makeFakeFileManager('/work/readme.md'),
      makeFakeSettingsProvider(),
      writer,
    );
    const detach = handler.attach();
    detach();
    dispatchPaste(ed.inner, [
      { kind: 'file', type: 'image/png', file: pngFile() },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(writer).not.toHaveBeenCalled();
  });

  it('does not double-process a single image present in both clipboardData.items and clipboardData.files (web-copy bug)', async () => {
    // Regression: when an image is copied from the web (right-click
    // → "Copy image"), Chromium populates BOTH `clipboardData.items`
    // and `clipboardData.files` with the same image — as distinct
    // `File` instances. An earlier version walked both surfaces and
    // a reference-based dedupe failed to merge them, so the same
    // image was saved twice and two markdown links were inserted:
    //   ![![](./assets/img_..._2.png)](./assets/img_....png)
    //
    // Fix: prefer `items`; only fall back to `files` when `items`
    // yielded nothing.
    const ed = makeFakeEditor();
    const writer = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, path: '/work/assets/once.png' });
    const handler = new PasteImageHandler(
      ed.api,
      makeFakeFileManager('/work/readme.md'),
      makeFakeSettingsProvider('./assets'),
      writer,
    );
    attachAndTrack(handler);

    // Synthesise a paste event where `items` AND `files` both
    // describe the same image (as distinct File instances, matching
    // Chromium's web-copy behaviour).
    const itemsFile = pngFile([1, 2, 3]);
    const filesFile = pngFile([1, 2, 3]); // same bytes, different File
    const event = Object.assign(new Event('paste', { bubbles: true }), {
      clipboardData: {
        items: [
          { kind: 'file', type: 'image/png', getAsFile: () => itemsFile },
        ],
        files: [filesFile],
      },
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    ed.inner.dispatchEvent(event as never);
    await new Promise((r) => setTimeout(r, 0));

    expect(writer).toHaveBeenCalledTimes(1);
    expect(ed.executeEdits).toHaveBeenCalledTimes(1);
  });

  it('falls back to clipboardData.files when items has no image entries (older Electron)', async () => {
    // Older Electron versions populate `files` but leave `items`
    // empty for image-only clipboards. Verify the fallback path
    // still picks the image up.
    const ed = makeFakeEditor();
    const writer = jest
      .fn()
      .mockResolvedValue({ ok: true, path: '/work/assets/x.png' });
    const handler = new PasteImageHandler(
      ed.api,
      makeFakeFileManager('/work/readme.md'),
      makeFakeSettingsProvider('./assets'),
      writer,
    );
    attachAndTrack(handler);

    const file = pngFile([7, 8, 9]);
    const event = Object.assign(new Event('paste', { bubbles: true }), {
      clipboardData: {
        items: [], // empty — no image entries
        files: [file],
      },
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    ed.inner.dispatchEvent(event as never);
    await new Promise((r) => setTimeout(r, 0));

    expect(writer).toHaveBeenCalledTimes(1);
    expect(ed.executeEdits).toHaveBeenCalledTimes(1);
  });

  it('ignores a paste event when the editor has no focus', async () => {
    // Window-level capture listener picks up paste events anywhere
    // in the renderer (assistant sidebar input, dialog text fields,
    // …). The handler must gate on `hasTextFocus()` so an unrelated
    // paste elsewhere doesn't accidentally route an image into the
    // markdown buffer.
    const ed = makeFakeEditor();
    ed.setTextFocus(false);
    const writer = jest.fn().mockResolvedValue({ ok: true, path: '/x.png' });
    const handler = new PasteImageHandler(
      ed.api,
      makeFakeFileManager('/work/readme.md'),
      makeFakeSettingsProvider(),
      writer,
    );
    attachAndTrack(handler);
    dispatchPaste(ed.inner, [
      { kind: 'file', type: 'image/png', file: pngFile() },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(writer).not.toHaveBeenCalled();
  });

  it('coerces an unknown image MIME extension to png', async () => {
    const ed = makeFakeEditor();
    const writer = jest.fn().mockResolvedValue({ ok: true, path: '/x.png' });
    const handler = new PasteImageHandler(
      ed.api,
      makeFakeFileManager('/work/readme.md'),
      makeFakeSettingsProvider(),
      writer,
    );
    attachAndTrack(handler);
    // image/x-icon isn't in the curated list — handler ignores it
    // (kind === 'file' && unmapped MIME → skipped before writer fires).
    dispatchPaste(ed.inner, [
      {
        kind: 'file',
        type: 'image/x-icon',
        file: new File([new Uint8Array([1, 2])], 'fav.ico', {
          type: 'image/x-icon',
        }),
      },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(writer).not.toHaveBeenCalled();
  });
});
