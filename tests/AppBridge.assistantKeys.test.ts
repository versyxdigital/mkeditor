import { ipcMain } from 'electron';
import { AppBridge } from '../src/app/lib/AppBridge';
import { AssistantKeyStore } from '../src/app/lib/AssistantKeyStore';
jest.mock('../src/app/lib/SecureChannel', () => ({
  SecureChannel: jest
    .fn()
    .mockImplementation(() => ({ decryptString: () => 'private-key' })),
}));
jest.mock('../src/app/lib/AssistantKeyStore', () => ({
  AssistantKeyStore: { setKey: jest.fn() },
}));

test.each([true, false])(
  'key writes acknowledge the actual storage result (%s)',
  async (ok) => {
    jest.clearAllMocks();
    let finish!: (value: boolean) => void;
    jest.mocked(AssistantKeyStore.setKey).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const context = {
      webContents: { id: 17, send: jest.fn() },
      setTitle: jest.fn(),
      once: jest.fn(),
      isDestroyed: () => false,
    };
    new AppBridge(context as never, true);
    const handler = jest
      .mocked(ipcMain.on)
      .mock.calls.find(([channel]) => channel === 'to:ai:key:set')![1];
    const pending = handler({ sender: { id: 17 } } as never, {
      provider: 'openai',
      ciphertext: 'encrypted',
      requestId: 'save-key',
    });
    expect(context.webContents.send).not.toHaveBeenCalled();
    finish(ok);
    await pending;
    expect(context.webContents.send).toHaveBeenCalledWith(
      'from:ai:key:result',
      { requestId: 'save-key', provider: 'openai', ok },
    );
    expect(JSON.stringify(context.webContents.send.mock.calls)).not.toContain(
      'private-key',
    );
  },
);
