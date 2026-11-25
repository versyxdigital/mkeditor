import { ipcMain } from 'electron';
import { AppBridge } from '../src/app/lib/AppBridge';
import { AppStorage } from '../src/app/lib/AppStorage';

jest.mock('../src/app/lib/AppStorage', () => ({
  AppStorage: {
    saveFile: jest.fn(),
    openPath: jest.fn(),
    showOpenDialog: jest.fn(),
    getPathProperties: jest.fn(),
  },
}));

function makeBridge() {
  const context = {
    webContents: { id: 17, send: jest.fn() },
    setTitle: jest.fn(),
    once: jest.fn(),
    isDestroyed: jest.fn(() => false),
  };
  const bridge = new AppBridge(context as never, true);
  const handler = (channel: string) => {
    const call = (ipcMain.on as jest.Mock).mock.calls.find(
      ([name]) => name === channel,
    );
    if (!call) throw new Error(`No handler for ${channel}`);
    return (payload: unknown) => call[1]({ sender: { id: 17 } }, payload);
  };
  return { bridge, context, handler };
}

async function drainMicrotasks() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('AppBridge correlated document saves', () => {
  beforeEach(() => jest.clearAllMocks());

  it('waits for the write result before acknowledging the captured request', async () => {
    let finish!: (result: { ok: boolean; path: string }) => void;
    (AppStorage.saveFile as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { context, handler } = makeBridge();
    handler('to:file:save')({
      file: '/notes.md',
      content: 'new text',
      requestId: 'save-1',
    });
    await drainMicrotasks();
    expect(context.webContents.send).not.toHaveBeenCalled();
    expect(AppStorage.saveFile).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        filePath: '/notes.md',
        data: 'new text',
        openFile: false,
      }),
    );
    finish({ ok: true, path: '/notes.md' });
    await drainMicrotasks();
    expect(context.webContents.send).toHaveBeenCalledWith(
      'from:file:save-result',
      {
        requestId: 'save-1',
        ok: true,
        path: '/notes.md',
      },
    );
  });

  it.each([
    { ok: false, cancelled: true },
    { ok: false, error: 'Disk full' },
  ])(
    'acknowledges Save As failure/cancellation without reopening another tab: %p',
    async (result) => {
      (AppStorage.saveFile as jest.Mock).mockResolvedValue(result);
      const { context, handler } = makeBridge();
      handler('to:file:saveas')({ content: 'scratch', requestId: 'save-as-2' });
      await drainMicrotasks();
      expect(AppStorage.saveFile).toHaveBeenCalledWith(
        context,
        expect.objectContaining({
          data: 'scratch',
          openFile: false,
        }),
      );
      expect(context.webContents.send).toHaveBeenCalledWith(
        'from:file:save-result',
        {
          requestId: 'save-as-2',
          ...result,
        },
      );
    },
  );

  it('retains legacy string Save As payloads', async () => {
    (AppStorage.saveFile as jest.Mock).mockResolvedValue({
      ok: true,
      path: '/saved.md',
    });
    const { context, handler } = makeBridge();
    handler('to:file:saveas')('legacy document');
    await drainMicrotasks();
    expect(AppStorage.saveFile).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ data: 'legacy document' }),
    );
    expect(context.webContents.send).not.toHaveBeenCalledWith(
      'from:file:save-result',
      expect.anything(),
    );
  });

  it('does not open a replacement document after the preceding save fails', async () => {
    (AppStorage.saveFile as jest.Mock).mockResolvedValue({
      ok: false,
      error: 'Disk full',
    });
    const { handler } = makeBridge();
    handler('to:file:save')({
      file: '/notes.md',
      content: 'unsaved',
      openPath: '/other.md',
    });
    await drainMicrotasks();
    expect(AppStorage.openPath).not.toHaveBeenCalled();
  });

  it('does not register process-global IPC handlers twice', () => {
    const { bridge } = makeBridge();
    const count = (ipcMain.on as jest.Mock).mock.calls.length;
    bridge.register();
    expect(ipcMain.on).toHaveBeenCalledTimes(count);
  });

  it('contains malformed payload errors and rejected fire-and-forget operations', async () => {
    const { bridge, handler } = makeBridge();
    const error = jest.fn();
    bridge.provide('logger', { log: { error } });
    expect(() => handler('to:settings:save')(undefined)).not.toThrow();
    (AppStorage.getPathProperties as jest.Mock).mockRejectedValue(
      new Error('permission denied'),
    );
    handler('to:file:properties')({ path: '/unreadable' });
    await drainMicrotasks();
    expect(error).toHaveBeenCalledWith(
      'IPC to:settings:save failed',
      expect.any(Error),
    );
    expect(error).toHaveBeenCalledWith(
      'IPC to:file:properties failed',
      expect.any(Error),
    );
  });
});
