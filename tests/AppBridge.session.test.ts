/**
 * Targeted test for the `to:session:save` IPC handler registered by
 * `AppBridge.register()`. The handler is a 2-line forward to
 * `AppSession.save`; the round-trip persistence behaviour is covered
 * in `AppSession.test.ts`, so we only assert the wiring here.
 */

jest.mock('../src/app/lib/AppSession', () => ({
  AppSession: {
    save: jest.fn(),
    load: jest.fn(() => null),
    buildRestoreEnvelope: jest.fn(() => ({
      session: null,
      missing: [],
      contents: {},
    })),
  },
}));

jest.mock('../src/app/lib/AppStorage', () => ({
  AppStorage: {},
}));

import { ipcMain } from 'electron';
import { AppBridge } from '../src/app/lib/AppBridge';
import { AppSession } from '../src/app/lib/AppSession';
import type { SessionPayload } from '../src/app/interfaces/Session';

describe('AppBridge to:session:save handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards the renderer payload to AppSession.save', () => {
    const context = {
      webContents: { send: jest.fn() },
      setTitle: jest.fn(),
    } as never;
    const bridge = new AppBridge(context);
    bridge.register();

    const onMock = ipcMain.on as unknown as jest.Mock;
    const saveCall = onMock.mock.calls.find((c) => c[0] === 'to:session:save');
    expect(saveCall).toBeDefined();
    const handler = saveCall![1] as (
      e: unknown,
      payload: SessionPayload,
    ) => void;

    const payload: SessionPayload = {
      version: 1,
      tabs: [
        {
          path: '/abs/foo.md',
          name: 'foo.md',
          viewState: null,
        },
      ],
      activeFile: '/abs/foo.md',
      workspaceRoot: null,
    };
    handler({}, payload);

    expect(AppSession.save).toHaveBeenCalledTimes(1);
    expect(AppSession.save).toHaveBeenCalledWith(payload);
  });
});
