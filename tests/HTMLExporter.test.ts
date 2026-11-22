import { HTMLExporter } from '../src/browser/core/HTMLExporter';
import { exportSettings } from '../src/browser/config';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('standalone document export', () => {
  it('preserves the HTML element and language and declares Unicode encoding', () => {
    const out = HTMLExporter.generateHTML(
      '<html lang="ja"><head></head><body><p>こんにちは</p></body></html>',
      exportSettings,
    );
    expect(out).toMatch(/^<!DOCTYPE html><html lang="ja">/);
    expect(out).toContain('<meta charset="utf-8">');
    expect(out).toContain('こんにちは');
  });

  it('removes internal scroll metadata without stripping document classes', () => {
    const out = HTMLExporter.generateHTML(
      '<div id="preview-content"><p class="has-line-data custom" data-line-start="1" data-line-end="2">Hello</p></div>',
      exportSettings,
    );
    const document = new DOMParser().parseFromString(out, 'text/html');
    expect(document.querySelector('p')?.className).toBe('custom');
    expect(document.querySelector('[data-line-start]')).toBeNull();
    expect(document.querySelector('[data-line-end]')).toBeNull();
  });

  it('does not claim copy success or leak a rejection when clipboard access fails', async () => {
    const out = HTMLExporter.generateHTML(
      '<div class="md-codeblock" data-source="aGVsbG8="><button class="md-codeblock-copy">Copy</button></div>',
      exportSettings,
    );
    const exported = new DOMParser().parseFromString(out, 'text/html');
    const copyScript = [...exported.querySelectorAll('script')].find(
      (script) => !script.src,
    )!.textContent!;
    const writeText = jest.fn().mockRejectedValue(new Error('denied'));
    new Function('document', 'navigator', copyScript)(exported, {
      clipboard: { writeText },
    });
    const button = exported.querySelector('button')!;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(button.classList.contains('is-copied')).toBe(false);
  });
});

describe('web export completion', () => {
  it('waits for both write and close before reporting completion', async () => {
    const write = deferred<void>();
    const close = deferred<void>();
    const writable = {
      write: jest.fn(() => write.promise),
      close: jest.fn(() => close.promise),
      abort: jest.fn(),
    };
    window.showSaveFilePicker = jest
      .fn()
      .mockResolvedValue({ createWritable: async () => writable });
    let complete = false;
    const saving = HTMLExporter.webExport('document').then((ok) => {
      complete = ok;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(complete).toBe(false);
    expect(writable.close).not.toHaveBeenCalled();
    write.resolve();
    await Promise.resolve();
    expect(writable.close).toHaveBeenCalledTimes(1);
    expect(complete).toBe(false);
    close.resolve();
    await saving;
    expect(complete).toBe(true);
  });

  it('settles cancelled pickers quietly', async () => {
    window.showSaveFilePicker = jest
      .fn()
      .mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    expect(await HTMLExporter.webExport('document')).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('aborts the temporary write after an error', async () => {
    const writable = {
      write: jest.fn().mockRejectedValue(new Error('disk full')),
      close: jest.fn(),
      abort: jest.fn().mockResolvedValue(undefined),
    };
    window.showSaveFilePicker = jest
      .fn()
      .mockResolvedValue({ createWritable: async () => writable });
    expect(await HTMLExporter.webExport('document')).toBe(false);
    expect(writable.close).not.toHaveBeenCalled();
    expect(writable.abort).toHaveBeenCalledTimes(1);
  });
});

describe('web PDF resource readiness', () => {
  function makePrintWindow() {
    const printWindow = {
      document: document.implementation.createHTMLDocument(''),
      focus: jest.fn(),
      print: jest.fn(),
      close: jest.fn(),
      closed: false,
    };
    jest
      .spyOn(window, 'open')
      .mockReturnValue(printWindow as unknown as Window);
    return printWindow;
  }

  it('waits for all distinct resources even when one emits duplicate events', async () => {
    const win = makePrintWindow();
    const saving = HTMLExporter.pdfWebExport(
      '<head><link rel="stylesheet" href="one.css"><link rel="stylesheet" href="two.css"></head><body>Hello</body>',
    );
    const [first, second] = win.document.querySelectorAll('link');
    first.dispatchEvent(new Event('load'));
    first.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(win.print).not.toHaveBeenCalled();
    second.dispatchEvent(new Event('error'));
    expect(await saving).toBe(true);
    expect(win.print).toHaveBeenCalledTimes(1);
  });

  it('does not wait for stylesheets already present in the browser cache', async () => {
    const win = makePrintWindow();
    jest
      .spyOn(HTMLLinkElement.prototype, 'sheet', 'get')
      .mockReturnValue({} as CSSStyleSheet);
    expect(
      await HTMLExporter.pdfWebExport(
        '<head><link rel="stylesheet" href="cached.css"></head><body>Hello</body>',
      ),
    ).toBe(true);
    expect(win.print).toHaveBeenCalledTimes(1);
  });

  it('waits for images as well as CSS before printing', async () => {
    const win = makePrintWindow();
    jest
      .spyOn(HTMLImageElement.prototype, 'complete', 'get')
      .mockReturnValue(false);
    const saving = HTMLExporter.pdfWebExport(
      '<body><img src="large.png"></body>',
    );
    await Promise.resolve();
    expect(win.print).not.toHaveBeenCalled();
    win.document.querySelector('img')!.dispatchEvent(new Event('load'));
    expect(await saving).toBe(true);
  });

  it('waits for the font-loading cycle started by a downloaded stylesheet', async () => {
    const win = makePrintWindow();
    const fonts = deferred<void>();
    let stylesheetLoaded = false;
    Object.defineProperty(win.document, 'fonts', {
      configurable: true,
      value: {
        get ready() {
          return stylesheetLoaded ? fonts.promise : Promise.resolve();
        },
      },
    });
    const saving = HTMLExporter.pdfWebExport(
      '<head><link rel="stylesheet" href="fonts.css"></head><body>Hello</body>',
    );
    stylesheetLoaded = true;
    win.document.querySelector('link')!.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();
    expect(win.print).not.toHaveBeenCalled();
    fonts.resolve();
    expect(await saving).toBe(true);
  });

  it('bounds resource waits when a CDN does not respond', async () => {
    jest.useFakeTimers();
    const win = makePrintWindow();
    const saving = HTMLExporter.pdfWebExport(
      '<head><link rel="stylesheet" href="offline.css"></head><body>Hello</body>',
    );
    await jest.advanceTimersByTimeAsync(5000);
    expect(await saving).toBe(true);
    expect(win.print).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not print a window that was closed while resources loaded', async () => {
    const win = makePrintWindow();
    const saving = HTMLExporter.pdfWebExport(
      '<head><link rel="stylesheet" href="slow.css"></head><body>Hello</body>',
    );
    win.closed = true;
    win.document.querySelector('link')!.dispatchEvent(new Event('load'));
    expect(await saving).toBe(false);
    expect(win.print).not.toHaveBeenCalled();
  });
});
