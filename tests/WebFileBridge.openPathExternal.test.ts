/**
 * Web-mode handling for the `to:shell:openpath` channel — the same
 * channel desktop uses to hand a file to the OS default app. Web
 * doesn't have a shell, but we don't want the click to vanish:
 * route through a blob URL + `window.open` so the browser renders
 * the image / PDF natively. Regression for the silent drop the
 * channel used to produce in web builds.
 */

jest.mock('../src/browser/core/HTMLExporter', () => ({
  HTMLExporter: { webExport: jest.fn(), pdfWebExport: jest.fn() },
}));

import { WebFileBridge } from '../src/browser/core/WebFileBridge';

interface FakeFileHandle {
  kind: 'file';
  name: string;
  getFile: jest.Mock<Promise<Blob>, []>;
}

function fakeFileHandle(content = 'hello'): FakeFileHandle {
  return {
    kind: 'file',
    name: 'cover.png',
    getFile: jest.fn(async () => new Blob([content], { type: 'image/png' })),
  };
}

/** Captured notification payloads from the `from:notification:display` channel. */
function captureNotifications(
  bridge: WebFileBridge,
): { status: string; key: string }[] {
  const captured: { status: string; key: string }[] = [];
  bridge.receive(
    'from:notification:display',
    (payload: { status: string; key: string }) => {
      captured.push(payload);
    },
  );
  return captured;
}

describe('WebFileBridge — to:shell:openpath', () => {
  const originalCreate = URL.createObjectURL;
  const originalOpen = window.open;

  beforeEach(() => {
    // jsdom doesn't implement URL.createObjectURL by default.
    (URL.createObjectURL as unknown) = jest.fn(() => 'blob:fake-url');
    (window.open as unknown) = jest.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    window.open = originalOpen;
  });

  it('opens a cached file handle via a blob URL in a new tab', async () => {
    const bridge = new WebFileBridge();
    const notifications = captureNotifications(bridge);
    const handle = fakeFileHandle();
    // Seed the handles cache so the bridge can find the file.
    (bridge as unknown as { handles: Map<string, unknown> }).handles.set(
      '/work/cover.png',
      handle,
    );

    bridge.send('to:shell:openpath', { path: '/work/cover.png' });
    // The handler is async — drain microtasks.
    await new Promise((r) => setTimeout(r, 0));

    expect(handle.getFile).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith('blob:fake-url', '_blank');
    expect(notifications).toEqual([]);
  });

  it('surfaces an error notification when the path has no cached handle (no silent drop)', async () => {
    // Regression: previously `to:shell:openpath` had no case in
    // `WebFileBridge.send`, so the click vanished without
    // user-visible feedback. Now we surface an
    // `unable_open_path` notification.
    const bridge = new WebFileBridge();
    const notifications = captureNotifications(bridge);

    bridge.send('to:shell:openpath', { path: '/not/in/cache.png' });
    await new Promise((r) => setTimeout(r, 0));

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(notifications).toEqual([
      { status: 'error', key: 'notifications:unable_open_path' },
    ]);
  });

  it('surfaces an error notification when the cached handle is a directory, not a file', async () => {
    const bridge = new WebFileBridge();
    const notifications = captureNotifications(bridge);
    (bridge as unknown as { handles: Map<string, unknown> }).handles.set(
      '/work/folder',
      { kind: 'directory', name: 'folder' },
    );

    bridge.send('to:shell:openpath', { path: '/work/folder' });
    await new Promise((r) => setTimeout(r, 0));

    expect(window.open).not.toHaveBeenCalled();
    expect(notifications).toEqual([
      { status: 'error', key: 'notifications:unable_open_path' },
    ]);
  });

  it('surfaces an error notification when getFile() throws', async () => {
    const bridge = new WebFileBridge();
    const notifications = captureNotifications(bridge);
    const handle = fakeFileHandle();
    handle.getFile.mockRejectedValueOnce(new Error('NotReadableError'));
    (bridge as unknown as { handles: Map<string, unknown> }).handles.set(
      '/work/broken.png',
      handle,
    );

    bridge.send('to:shell:openpath', { path: '/work/broken.png' });
    await new Promise((r) => setTimeout(r, 0));

    expect(window.open).not.toHaveBeenCalled();
    expect(notifications).toEqual([
      { status: 'error', key: 'notifications:unable_open_path' },
    ]);
  });
});
