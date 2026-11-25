/**
 * Session IPC forwarding. Workspace-root authority is additionally
 * covered with real AppStorage state in AppStorage.workspaceAuthorization.
 */

jest.mock('../src/app/lib/AppSession', () => ({
  AppSession: {
    save: jest.fn(() => true),
    isValidPayload: jest.fn(() => true),
    load: jest.fn(() => null),
    clear: jest.fn(() => true),
    buildRestoreEnvelope: jest.fn(() => ({
      session: null,
      missing: [],
      contents: {},
    })),
  },
}));

jest.mock('../src/app/lib/cloud/CloudRecoveryStore', () => ({
  cloudRecoveryStore: {
    load: jest.fn(async () => ({
      version: 1,
      operations: [],
      acknowledged: [],
    })),
    saveSession: jest.fn(async () => {}),
  },
}));

jest.mock('../src/app/lib/AppStorage', () => ({
  AppStorage: { getSessionWorkspaceRoot: jest.fn(() => null) },
}));

import { ipcMain } from 'electron';
import { AppBridge } from '../src/app/lib/AppBridge';
import { AppSession } from '../src/app/lib/AppSession';
import type { SessionPayload } from '../src/app/interfaces/Session';

describe('AppBridge to:session:save handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards the renderer payload to AppSession.save', async () => {
    const context = {
      webContents: { id: 1, send: jest.fn() },
      setTitle: jest.fn(),
      once: jest.fn(),
      isDestroyed: () => false,
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
    handler({ sender: { id: 1 } }, payload);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(AppSession.save).toHaveBeenCalledTimes(1);
    expect(AppSession.save).toHaveBeenCalledWith(
      expect.objectContaining({ ...payload, version: 3 }),
    );
  });
});

describe('AppBridge to:session:clear handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls AppSession.clear and fires the success notification', async () => {
    const send = jest.fn();
    const context = {
      webContents: { id: 1, send },
      setTitle: jest.fn(),
      once: jest.fn(),
      isDestroyed: () => false,
    } as never;
    const bridge = new AppBridge(context);
    bridge.register();

    const onMock = ipcMain.on as unknown as jest.Mock;
    const clearCall = onMock.mock.calls.find(
      (c) => c[0] === 'to:session:clear',
    );
    expect(clearCall).toBeDefined();
    const handler = clearCall![1] as (e: unknown) => void;

    handler({ sender: { id: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(AppSession.clear).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('from:notification:display', {
      status: 'success',
      key: 'notifications:session_cleared',
    });
  });
});

test('the final flush is acknowledged only after the recovery checkpoint completes', async () => {
  const {
    cloudRecoveryStore,
  } = require('../src/app/lib/cloud/CloudRecoveryStore');
  let finish!: () => void;
  cloudRecoveryStore.saveSession.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const send = jest.fn();
  const context = {
    webContents: { id: 7, send },
    isDestroyed: () => false,
    once: jest.fn(),
    setTitle: jest.fn(),
  } as never;
  const bridge = new AppBridge(context, true);
  const result = bridge.flushSession();
  const id = send.mock.calls.find(
    ([channel]) => channel === 'from:session:flush-request',
  )![1].id;
  const handler = (ipcMain.on as jest.Mock).mock.calls
    .filter(([channel]) => channel === 'to:session:save')
    .at(-1)![1];
  let settled = false;
  void result.then(() => {
    settled = true;
  });
  handler(
    { sender: { id: 7 } },
    {
      version: 3,
      tabs: [],
      activeFile: null,
      workspaceRoot: null,
      flushId: id,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  finish();
  expect(await result).toBe(true);
});

test('a failed recovery checkpoint does not report a successful flush', async () => {
  const {
    cloudRecoveryStore,
  } = require('../src/app/lib/cloud/CloudRecoveryStore');
  cloudRecoveryStore.saveSession.mockRejectedValueOnce(new Error('storage'));
  const send = jest.fn();
  const context = {
    webContents: { id: 8, send },
    isDestroyed: () => false,
    once: jest.fn(),
    setTitle: jest.fn(),
  } as never;
  const bridge = new AppBridge(context, true),
    result = bridge.flushSession();
  const id = send.mock.calls.find(
    ([channel]) => channel === 'from:session:flush-request',
  )![1].id;
  const handler = (ipcMain.on as jest.Mock).mock.calls
    .filter(([channel]) => channel === 'to:session:save')
    .at(-1)![1];
  handler(
    { sender: { id: 8 } },
    {
      version: 3,
      tabs: [],
      activeFile: null,
      workspaceRoot: null,
      flushId: id,
    },
  );
  expect(await result).toBe(false);
  expect(send).toHaveBeenCalledWith('from:session:saved', { ok: false });
});
