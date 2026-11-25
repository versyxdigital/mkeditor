import { CloudManager } from '../src/browser/core/CloudManager';
import type {
  CloudRequest,
  CloudResponse,
  CloudState,
  CloudProviderId,
  CloudWriteError,
} from '../src/app/interfaces/Cloud';
import { confirmExternal, openPromptExternal } from '../src/browser/prompts';
import { sonnerToast } from '../src/browser/notify';

jest.mock('../src/browser/notify', () => ({ sonnerToast: jest.fn() }));
jest.mock('../src/browser/i18n', () => ({ t: jest.fn((key: string) => key) }));

jest.mock('../src/browser/prompts', () => ({
  confirmExternal: jest.fn(async () => false),
  openPromptExternal: jest.fn(async () => ({ button: null })),
}));

function setup(provider?: CloudProviderId) {
  const handlers = new Map<string, (value: never) => void>();
  const requests: CloudRequest[] = [];
  const files = {
    openRemoteDocument: jest.fn(),
    activeFile: null as string | null,
    createLocalCopy: jest.fn(),
    setRemoteOperations: jest.fn(),
    refreshRemoteAccess: jest.fn(),
    checkRecoveredRemoteDocuments: jest.fn(),
    tabs: new Map(),
    models: new Map(),
    getSnapshot: jest.fn(),
    hasUnconfirmedRemoteSave: jest.fn(() => false),
    moveRemoteDocument: jest.fn(
      async (_identity: unknown, move: () => Promise<unknown>) => {
        await move();
      },
    ),
    reloadRemoteDocument: jest.fn(),
    openDiffTab: jest.fn(),
  };
  const bridge = {
    receive: (channel: string, fn: (value: never) => void) => {
      handlers.set(channel, fn);
    },
    send: (_channel: string, value: CloudRequest) => {
      requests.push(value);
    },
  };
  const manager = new CloudManager(bridge, files as never);
  const state: CloudState = {
    revision: 1,
    secureStorage: true,
    googleDriveAvailable: true,
    connections: [
      {
        id: 'drive',
        provider,
        name: 'Drive',
        clientId: 'client',
        clientValue: '',
        accountId: 'account',
        status: 'connected',
      },
    ],
  };
  const push = (value: CloudState) =>
    handlers.get('from:cloud:state')!(value as never);
  const respond = (
    request: CloudRequest,
    value: Omit<Extract<CloudResponse, { ok: true }>, 'requestId'>,
  ) =>
    handlers.get('from:cloud:result')!({
      requestId: request.requestId,
      ...value,
    } as never);
  const fail = (request: CloudRequest, error: CloudWriteError) =>
    handlers.get('from:cloud:result')!({
      requestId: request.requestId,
      ok: false,
      error,
    } as never);
  return { manager, files, requests, state, push, respond, fail };
}

beforeEach(() => {
  jest.mocked(sonnerToast).mockClear();
  jest
    .mocked(openPromptExternal)
    .mockReset()
    .mockResolvedValue({ button: null });
});

test('remote discard waits for its correlated durable response and surfaces persistence failure', async () => {
  const { manager, files, requests, state, respond, fail } = setup();
  const operations = files.setRemoteOperations.mock.calls[0][0];
  const document = {
    connectionId: 'drive',
    accountId: 'account',
    item: { id: 'item' },
  };
  let finished = false;
  const pending = operations.discard(document, ['pending-save']).then(() => {
    finished = true;
  });
  expect(requests.at(-1)?.command).toEqual({
    action: 'discardDocument',
    document: {
      provider: undefined,
      connectionId: 'drive',
      accountId: 'account',
      itemId: 'item',
      operationIds: ['pending-save'],
    },
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  respond(requests.at(-1)!, { ok: true, state });
  await pending;
  expect(finished).toBe(true);
  const denied = operations.discard(document, ['another-save']);
  fail(requests.at(-1)!, 'storage');
  await expect(denied).rejects.toBe('storage');
  manager.dispose();
});

afterEach(() => {
  jest.useRealTimers();
});

test('reload asks before discarding a dirty remote buffer and refuses edits made during the fetch', async () => {
  const { manager, files, requests, respond, state, push } = setup();
  push(state);
  let version = 2;
  const model = {
    getAlternativeVersionId: () => version,
    getValue: () => 'my edits',
  };
  const remote = {
    connectionId: 'drive',
    accountId: 'account',
    connectionName: 'Drive',
    item: {
      id: 'markdown',
      name: 'notes.md',
      kind: 'markdown' as const,
      parents: [],
    },
  };
  files.tabs.set('path', { remote });
  files.models.set('path', model);
  files.getSnapshot.mockReturnValue({ tabs: [{ path: 'path', dirty: true }] });
  const reload = manager.reload('path');
  respond(requests.at(-1)!, {
    ok: true,
    state,
    document: { ...remote, content: 'latest' },
  });
  await reload;
  expect(confirmExternal).toHaveBeenCalled();
  expect(files.reloadRemoteDocument).not.toHaveBeenCalled();
  (confirmExternal as jest.Mock).mockResolvedValueOnce(true);
  const retry = manager.reload('path');
  version++;
  respond(requests.at(-1)!, {
    ok: true,
    state,
    document: { ...remote, content: 'latest' },
  });
  await retry;
  expect(files.reloadRemoteDocument).not.toHaveBeenCalled();
  expect(manager.getSnapshot().error).toBe('conflict');
  manager.dispose();
});

test('write timeout becomes unconfirmed rather than an invitation to replay', async () => {
  jest.useFakeTimers();
  const { manager, files, state, push } = setup();
  push(state);
  const operations = files.setRemoteOperations.mock.calls[0][0];
  const save = operations.save({
    document: {
      connectionId: 'drive',
      accountId: 'account',
      item: { id: 'markdown', validator: '"etag"' },
    },
    content: 'snapshot',
    operationId: 'write-1',
  });
  const rejection = expect(save).rejects.toBe('unconfirmed');
  jest.advanceTimersByTime(65_000);
  await rejection;
  manager.dispose();
});

test('one-click sign-in allows the browser flow time and selects the authorized workspace', async () => {
  jest.useFakeTimers();
  const { manager, state, requests, respond } = setup();
  const running = manager.run({
    action: 'add',
    name: 'Google Drive',
    authorize: true,
  });
  const pending = requests.at(-1)!;
  jest.advanceTimersByTime(65_000);
  expect(manager.getSnapshot().busy).toEqual(['settings']);
  respond(pending, { ok: true, state, connectionId: 'drive' });
  expect(await running).toBe(true);
  expect(manager.getSnapshot()).toMatchObject({ workspace: 'drive', busy: [] });
  expect(requests.at(-1)!.command).toMatchObject({
    action: 'list',
    connectionId: 'drive',
    folderId: 'root',
  });
  manager.dispose();
});

test('snapshot is stable; late browsing results cannot populate another workspace', async () => {
  const { manager, state, push, requests, respond } = setup();
  const initial = manager.getSnapshot();
  expect(manager.getSnapshot()).toBe(initial);
  const changed = jest.fn();
  const unsubscribe = manager.subscribe(changed);
  push(state);
  manager.selectWorkspace('drive');
  const pending = requests.at(-1)!;
  expect(manager.getSnapshot().loading).toBe(true);
  manager.selectWorkspace('local');
  respond(pending, {
    ok: true,
    state,
    page: {
      items: [{ id: 'file', name: 'notes.md', kind: 'markdown', parents: [] }],
    },
  });
  await Promise.resolve();
  expect(manager.getSnapshot()).toMatchObject({
    workspace: 'local',
    items: [],
    loading: false,
  });
  expect(changed).toHaveBeenCalled();
  unsubscribe();
  manager.dispose();
});

describe.each<CloudProviderId>(['google-drive', 'dropbox'])(
  '%s editing introduction',
  (provider) => {
    test.each(['cancel', null])(
      'offers editing after sign-in and keeps read-only access on %s',
      async (button) => {
        const { manager, state, requests, respond } = setup(provider);
        state.connections[0].hasConnected = true;
        jest.mocked(openPromptExternal).mockResolvedValueOnce({ button });
        const signingIn = manager.run({
          action: 'add',
          provider,
          name: 'Cloud',
          authorize: true,
        });
        expect(openPromptExternal).not.toHaveBeenCalled();
        respond(requests.at(-1)!, { ok: true, state, connectionId: 'drive' });
        expect(await signingIn).toBe(true);
        expect(openPromptExternal).toHaveBeenCalledTimes(1);
        expect(openPromptExternal).toHaveBeenCalledWith(
          expect.objectContaining({
            description: `cloud:${provider === 'dropbox' ? 'dropbox.' : ''}editing_intro_description`,
            buttons: [
              { id: 'cancel', label: 'cloud:later', variant: 'secondary' },
              {
                id: 'confirm',
                label: 'cloud:enable_editing_now',
                variant: 'primary',
              },
            ],
          }),
        );
        expect(manager.getSnapshot().busy).toEqual([]);
        expect(
          requests.some((request) => request.command.action === 'connect'),
        ).toBe(false);
        expect(manager.getSnapshot().connections[0].writeAccess).not.toBe(true);
        manager.dispose();
      },
    );

    test('Now starts the editing authorization and a failed upgrade retains read-only access', async () => {
      const { manager, state, push, requests, respond, fail } = setup(provider);
      push({
        ...state,
        connections: [
          {
            ...state.connections[0],
            accountId: undefined,
            status: 'disconnected',
          },
        ],
      });
      jest
        .mocked(openPromptExternal)
        .mockResolvedValueOnce({ button: 'confirm' });
      const signingIn = manager.run({
        action: 'connect',
        connectionId: 'drive',
      });
      const connected = {
        ...state,
        revision: 2,
        connections: [{ ...state.connections[0], hasConnected: true }],
      };
      respond(requests.at(-1)!, { ok: true, state: connected });
      await signingIn;
      const upgrade = requests.at(-1)!;
      expect(upgrade.command).toMatchObject({
        action: 'connect',
        connectionId: 'drive',
        writeAccess: true,
      });
      expect(manager.getSnapshot().busy).toEqual(['drive']);
      fail(upgrade, 'permission');
      await Promise.resolve();
      expect(manager.getSnapshot().connections[0]).toMatchObject({
        status: 'connected',
        hasConnected: true,
      });
      expect(manager.getSnapshot().connections[0].writeAccess).not.toBe(true);
      expect(manager.getSnapshot().error).toBe('permission');
      expect(openPromptExternal).toHaveBeenCalledTimes(1);
      manager.dispose();
    });

    test('restoring and reconnecting a previously connected account do not repeat the introduction', async () => {
      const { manager, state, push, requests, respond } = setup(provider);
      state.connections[0] = {
        ...state.connections[0],
        hasConnected: true,
        accountId: undefined,
        status: 'disconnected',
      };
      push(state);
      expect(openPromptExternal).not.toHaveBeenCalled();
      const reconnecting = manager.run({
        action: 'connect',
        connectionId: 'drive',
      });
      respond(requests.at(-1)!, {
        ok: true,
        state: {
          ...state,
          revision: 2,
          connections: [
            {
              ...state.connections[0],
              status: 'connected',
              accountId: 'account',
            },
          ],
        },
      });
      await reconnecting;
      expect(openPromptExternal).not.toHaveBeenCalled();
      manager.dispose();
    });

    test('failed sign-in and an already editable connection do not show the introduction', async () => {
      const { manager, state, requests, respond, fail } = setup(provider);
      const failed = manager.run({
        action: 'add',
        provider,
        name: 'Cloud',
        authorize: true,
      });
      fail(requests.at(-1)!, 'cancelled');
      expect(await failed).toBe(false);
      const editable = manager.run({
        action: 'add',
        provider,
        name: 'Cloud',
        authorize: true,
      });
      respond(requests.at(-1)!, {
        ok: true,
        connectionId: 'drive',
        state: {
          ...state,
          connections: [{ ...state.connections[0], writeAccess: true }],
        },
      });
      await editable;
      expect(openPromptExternal).not.toHaveBeenCalled();
      manager.dispose();
    });

    test.each(['disconnect', 'account-change', 'dispose'])(
      'a prompt cannot authorize editing after %s',
      async (change) => {
        const { manager, state, push, requests, respond } = setup(provider);
        let answer!: (result: { button: string }) => void;
        jest.mocked(openPromptExternal).mockReturnValueOnce(
          new Promise((resolve) => {
            answer = resolve;
          }),
        );
        const signingIn = manager.run({
          action: 'add',
          provider,
          name: 'Cloud',
          authorize: true,
        });
        respond(requests.at(-1)!, { ok: true, state, connectionId: 'drive' });
        await signingIn;
        if (change === 'dispose') manager.dispose();
        else
          push({
            ...state,
            revision: 2,
            connections: [
              {
                ...state.connections[0],
                ...(change === 'disconnect'
                  ? { status: 'disconnected', accountId: undefined }
                  : { accountId: 'other' }),
              },
            ],
          });
        answer({ button: 'confirm' });
        await Promise.resolve();
        expect(
          requests.some((request) => request.command.action === 'connect'),
        ).toBe(false);
        manager.dispose();
      },
    );
  },
);

test('disconnect clears listing, ignores stale state, and keeps open documents intact', async () => {
  const { manager, state, push, requests, respond, files } = setup();
  push(state);
  manager.selectWorkspace('drive');
  respond(requests.at(-1)!, {
    ok: true,
    state,
    page: {
      items: [{ id: 'file', name: 'notes.md', kind: 'markdown', parents: [] }],
      nextPage: 'more',
    },
  });
  await Promise.resolve();
  expect(manager.getSnapshot().items).toHaveLength(1);
  push({
    ...state,
    revision: 2,
    connections: [
      { ...state.connections[0], accountId: undefined, status: 'disconnected' },
    ],
  });
  push(state);
  expect(manager.getSnapshot()).toMatchObject({
    items: [],
    nextPage: undefined,
    connections: [{ status: 'disconnected' }],
  });
  expect(files.openRemoteDocument).not.toHaveBeenCalled();
  push({ ...state, revision: 3, connections: [] });
  expect(manager.getSnapshot().workspace).toBe('local');
  manager.dispose();
});

test('a download completing after sign-out/account change never opens as the new account', async () => {
  const { manager, state, push, requests, respond, files } = setup();
  push(state);
  manager.selectWorkspace('drive');
  respond(requests.at(-1)!, { ok: true, state, page: { items: [] } });
  await Promise.resolve();
  const open = manager.open({
    id: 'file',
    name: 'notes.md',
    kind: 'markdown',
    parents: [],
  });
  const pending = requests.at(-1)!;
  push({
    ...state,
    revision: 2,
    connections: [{ ...state.connections[0], accountId: 'different' }],
  });
  respond(pending, {
    ok: true,
    state,
    document: {
      connectionId: 'drive',
      accountId: 'account',
      connectionName: 'Drive',
      item: { id: 'file', name: 'notes.md', kind: 'markdown', parents: [] },
      content: 'content',
    },
  });
  await open;
  expect(files.openRemoteDocument).not.toHaveBeenCalled();
  manager.dispose();
});

test('missing IPC responses time out with actionable UI state', async () => {
  jest.useFakeTimers();
  const { manager } = setup();
  const run = manager.run({ action: 'test', connectionId: 'drive' });
  jest.advanceTimersByTime(65_000);
  expect(await run).toBe(false);
  expect(manager.getSnapshot()).toMatchObject({ error: 'network', busy: [] });
  manager.dispose();
});

test('opening tracks individual downloads, prevents duplicate requests and clears each completed operation', async () => {
  const { manager, files, requests, state, push, respond } = setup();
  push(state);
  manager.selectWorkspace('drive');
  const item = {
    id: 'first',
    name: 'intro.md',
    kind: 'markdown' as const,
    parents: [],
  };
  const first = manager.open(item);
  const firstRequest = requests.at(-1)!;
  await manager.open(item);
  expect(
    requests.filter((request) => request.command.action === 'open'),
  ).toHaveLength(1);
  const second = manager.open({ ...item, id: 'second', name: 'math.md' });
  const secondRequest = requests.at(-1)!;
  expect(manager.getSnapshot().opening).toHaveLength(2);
  respond(firstRequest, {
    ok: true,
    state,
    document: {
      connectionId: 'drive',
      accountId: 'account',
      connectionName: 'Drive',
      item,
      content: '# Intro',
    },
  });
  await first;
  expect(files.openRemoteDocument).toHaveBeenCalledTimes(1);
  expect(
    manager.getSnapshot().opening.map((operation) => operation.itemId),
  ).toEqual(['second']);
  respond(secondRequest, { ok: true, state });
  await second;
  expect(manager.getSnapshot().opening).toEqual([]);
  manager.dispose();
});

test('download timeouts clear progress and a signed-out download cannot reopen after reconnecting', async () => {
  jest.useFakeTimers();
  const { manager, files, requests, state, push, respond } = setup();
  push(state);
  manager.selectWorkspace('drive');
  const item = {
    id: 'file',
    name: 'intro.md',
    kind: 'markdown' as const,
    parents: [],
  };
  const timed = manager.open(item);
  expect(manager.getSnapshot().opening).toHaveLength(1);
  jest.advanceTimersByTime(65_000);
  await timed;
  expect(manager.getSnapshot()).toMatchObject({
    opening: [],
    error: 'network',
  });
  const stale = manager.open(item);
  const oldRequest = requests.at(-1)!;
  push({
    ...state,
    revision: 2,
    connections: [{ ...state.connections[0], status: 'disconnected' }],
  });
  expect(manager.getSnapshot().opening).toEqual([]);
  push({ ...state, revision: 3 });
  respond(oldRequest, {
    ok: true,
    state,
    document: {
      connectionId: 'drive',
      accountId: 'account',
      connectionName: 'Drive',
      item,
      content: 'stale',
    },
  });
  await stale;
  expect(files.openRemoteDocument).not.toHaveBeenCalled();
  manager.dispose();
});

test('creation progress begins after confirmation, keeps the copied snapshot and clears on failure', async () => {
  const { manager, files, requests, state, push } = setup();
  state.connections[0].writeAccess = true;
  push(state);
  manager.selectWorkspace('drive');
  let content = 'unsaved draft';
  files.activeFile = 'untitled-1';
  files.models.set('untitled-1', { getValue: () => content });
  jest
    .mocked(openPromptExternal)
    .mockResolvedValueOnce({ button: 'confirm', value: 'draft.md' });
  const creating = manager.create(true);
  expect(manager.getSnapshot().creating).toBeUndefined();
  content = 'edited later';
  await Promise.resolve();
  expect(manager.getSnapshot().creating).toMatchObject({
    connectionId: 'drive',
    folderId: 'root',
    name: 'draft.md',
  });
  const request = requests.at(-1)!;
  expect(request.command).toMatchObject({
    action: 'create',
    content: 'unsaved draft',
  });
  const count = requests.length;
  await manager.create();
  expect(requests).toHaveLength(count);
  manager.dispose();
  await creating;
  expect(manager.getSnapshot()).toMatchObject({
    busy: [],
    creating: undefined,
  });
  expect(files.createLocalCopy).not.toHaveBeenCalled();
});

test('cancelled or failed name prompts release creation controls without starting a write', async () => {
  const { manager, requests, state, push } = setup();
  state.connections[0].writeAccess = true;
  push(state);
  manager.selectWorkspace('drive');
  jest.mocked(openPromptExternal).mockResolvedValueOnce({ button: null });
  await manager.create();
  expect(manager.getSnapshot().busy).toEqual([]);
  expect(manager.getSnapshot().creating).toBeUndefined();
  jest
    .mocked(openPromptExternal)
    .mockRejectedValueOnce(new Error('prompt failed'));
  await manager.create();
  expect(manager.getSnapshot().busy).toEqual([]);
  expect(manager.getSnapshot().creating).toBeUndefined();
  expect(requests.some((request) => request.command.action === 'create')).toBe(
    false,
  );
  expect(sonnerToast).not.toHaveBeenCalled();
  manager.dispose();
});

describe.each<CloudProviderId>(['google-drive', 'dropbox'])(
  '%s creation notifications',
  (provider) => {
    test.each([false, true])(
      'confirms an acknowledged creation once (copy: %s)',
      async (copy) => {
        const { manager, files, requests, state, push, respond } =
          setup(provider);
        state.connections[0].writeAccess = true;
        push(state);
        manager.selectWorkspace('drive');
        files.activeFile = 'untitled-1';
        files.models.set('untitled-1', { getValue: () => 'unsaved draft' });
        jest
          .mocked(openPromptExternal)
          .mockResolvedValueOnce({ button: 'confirm', value: 'New.md' });
        const creating = manager.create(copy);
        await Promise.resolve();
        const request = requests.at(-1)!;
        expect(sonnerToast).not.toHaveBeenCalled();
        // Completing the operation still reports its result after changing workspaces.
        manager.selectWorkspace('local');
        const document = {
          connectionId: 'drive',
          accountId: 'account',
          connectionName: 'Drive',
          provider,
          item: {
            id: 'new',
            name: 'New.md',
            kind: 'markdown' as const,
            parents: [],
          },
          content: copy ? 'unsaved draft' : '',
        };
        respond(request, { ok: true, state, document });
        await creating;
        expect(files.openRemoteDocument).toHaveBeenCalledWith(document);
        expect(sonnerToast).toHaveBeenCalledTimes(1);
        expect(sonnerToast).toHaveBeenCalledWith(
          'success',
          'cloud:created_file',
        );
        manager.dispose();
      },
    );

    test.each<CloudWriteError>(['duplicate', 'network', 'unconfirmed'])(
      'reports %s as an error toast, without a success toast',
      async (error) => {
        const { manager, files, requests, state, push, fail } = setup(provider);
        state.connections[0].writeAccess = true;
        push(state);
        manager.selectWorkspace('drive');
        jest
          .mocked(openPromptExternal)
          .mockResolvedValueOnce({ button: 'confirm', value: 'New.md' });
        const creating = manager.create();
        await Promise.resolve();
        const request = requests.at(-1)!;
        manager.selectWorkspace('local');
        fail(request, error);
        await creating;
        expect(files.openRemoteDocument).not.toHaveBeenCalled();
        expect(sonnerToast).toHaveBeenCalledTimes(1);
        expect(sonnerToast).toHaveBeenCalledWith(
          'error',
          `cloud:${provider === 'dropbox' && error !== 'duplicate' ? 'dropbox.' : ''}error_${error}`,
        );
        expect(Boolean(manager.getSnapshot().pendingCreate)).toBe(
          error === 'unconfirmed',
        );
        manager.dispose();
      },
    );

    test('confirms a previously uncertain creation only after checking its result', async () => {
      const { manager, requests, state, push, fail, respond } = setup(provider);
      state.connections[0].writeAccess = true;
      push(state);
      manager.selectWorkspace('drive');
      jest
        .mocked(openPromptExternal)
        .mockResolvedValueOnce({ button: 'confirm', value: 'New.md' });
      const creating = manager.create();
      await Promise.resolve();
      fail(requests.at(-1)!, 'unconfirmed');
      await creating;
      jest.mocked(sonnerToast).mockClear();
      const checking = manager.reconcileCreate();
      await manager.reconcileCreate();
      expect(sonnerToast).not.toHaveBeenCalled();
      respond(requests.at(-1)!, {
        ok: true,
        state,
        document: {
          connectionId: 'drive',
          accountId: 'account',
          connectionName: 'Drive',
          provider,
          item: { id: 'new', name: 'New.md', kind: 'markdown', parents: [] },
          content: '',
        },
      });
      await checking;
      expect(sonnerToast).toHaveBeenCalledTimes(1);
      expect(sonnerToast).toHaveBeenCalledWith('success', 'cloud:created_file');
      expect(manager.getSnapshot().pendingCreate).toBeUndefined();
      manager.dispose();
    });
  },
);

function organizing(provider?: CloudProviderId) {
  const context = setup(provider);
  context.state.connections[0].writeAccess = true;
  context.push(context.state);
  context.manager.selectWorkspace('drive');
  context.respond(context.requests.at(-1)!, {
    ok: true,
    state: context.state,
    page: { items: [] },
  });
  return context;
}
const movable = {
  id: 'notes',
  name: 'notes.md',
  kind: 'markdown' as const,
  parents: ['root'],
};
const destination = {
  id: 'folder',
  name: 'Drafts',
  kind: 'folder' as const,
  parents: ['root'],
};

describe.each<CloudProviderId>(['google-drive', 'dropbox'])(
  '%s recovery account boundaries',
  (provider) => {
    test.each(['create', 'folder'] as const)(
      'retains a pending %s across switches but sends recovery only from its connected account',
      async (kind) => {
        const { manager, requests, state, push, fail } = organizing(provider);
        jest.mocked(openPromptExternal).mockResolvedValueOnce({
          button: 'confirm',
          value: kind === 'create' ? 'New.md' : 'Folder',
        });
        const creating =
          kind === 'create' ? manager.create() : manager.createFolder();
        await Promise.resolve();
        fail(requests.at(-1)!, 'unconfirmed');
        await creating;
        const pending =
          kind === 'create'
            ? manager.getSnapshot().pendingCreate
            : manager.getSnapshot().pendingItem;
        expect(pending).toBeDefined();
        const restored = {
          provider,
          connectionId: 'drive',
          accountId: 'account',
          operationId: 'restored',
          itemId: 'item',
          kind: 'save' as const,
        };
        const original = { ...state, pendingOperations: [restored] };
        const check = async () => {
          await manager.reconcileCreate();
          await manager.reconcileItem();
          await manager.checkRestoredOperation(restored);
        };
        const recoveryCount = () =>
          requests.filter((request) =>
            ['reconcile', 'reconcileItem'].includes(request.command.action),
          ).length;
        push({
          ...original,
          connections: [
            ...state.connections,
            {
              ...state.connections[0],
              id: 'other',
              accountId: 'other-account',
            },
          ],
        });
        manager.selectWorkspace('other');
        await check();
        expect(recoveryCount()).toBe(0);
        manager.selectWorkspace('drive');
        push({
          ...original,
          connections: [{ ...state.connections[0], accountId: 'replacement' }],
        });
        await check();
        expect(recoveryCount()).toBe(0);
        push({
          ...original,
          connections: [{ ...state.connections[0], status: 'disconnected' }],
        });
        await check();
        expect(recoveryCount()).toBe(0);
        expect(
          kind === 'create'
            ? manager.getSnapshot().pendingCreate
            : manager.getSnapshot().pendingItem,
        ).toEqual(pending);
        expect(manager.getSnapshot().pendingOperations).toEqual([restored]);
        push(original);
        const checking =
          kind === 'create'
            ? manager.reconcileCreate()
            : manager.reconcileItem();
        expect(requests.at(-1)?.command).toMatchObject({
          action: kind === 'create' ? 'reconcile' : 'reconcileItem',
          connectionId: 'drive',
          accountId: 'account',
          operationId: pending!.operationId,
        });
        fail(requests.at(-1)!, 'unconfirmed');
        await checking;
        const restoredCheck = manager.checkRestoredOperation(restored);
        expect(requests.at(-1)?.command).toMatchObject({
          action: 'reconcile',
          connectionId: 'drive',
          accountId: 'account',
          operationId: 'restored',
        });
        fail(requests.at(-1)!, 'unconfirmed');
        await restoredCheck;
        manager.dispose();
      },
    );
  },
);

test.each<CloudProviderId>(['google-drive', 'dropbox'])(
  '%s folder creation shows progress after confirmation and cancellation performs no write',
  async (provider) => {
    const { manager, requests, respond, state } = organizing(provider);
    (openPromptExternal as jest.Mock).mockResolvedValueOnce({ button: null });
    await manager.createFolder();
    expect(requests.some((req) => req.command.action === 'createFolder')).toBe(
      false,
    );
    (openPromptExternal as jest.Mock).mockResolvedValueOnce({
      button: 'confirm',
      value: 'Drafts',
    });
    const pending = manager.createFolder();
    await Promise.resolve();
    expect(manager.getSnapshot().creating).toMatchObject({
      name: 'Drafts',
      folderId: 'root',
    });
    const command = requests.at(-1)!;
    expect(command.command).toMatchObject({
      action: 'createFolder',
      name: 'Drafts',
      accountId: 'account',
    });
    respond(command, { ok: true, state, item: destination });
    await pending;
    expect(manager.getSnapshot().creating).toBeUndefined();
    expect(manager.getSnapshot().busy).not.toContain('organize');
    manager.dispose();
  },
);

test.each<CloudProviderId>(['google-drive'])(
  '%s move picker filters documents, paginates folders and leaves Explorer in place',
  async (provider) => {
    const { manager, requests, respond, state } = organizing(provider);
    manager.startMove(movable);
    respond(requests.at(-1)!, {
      ok: true,
      state,
      page: { items: [movable, destination], nextPage: 'more' },
    });
    await Promise.resolve();
    expect(manager.getSnapshot().movePicker?.items).toEqual([destination]);
    const root = [
      {
        id: 'root',
        name: provider === 'dropbox' ? 'dropbox_root' : 'my_drive',
      },
    ];
    const next = manager.browseMove(root, true);
    expect(requests.at(-1)!.command).toMatchObject({
      action: 'list',
      page: 'more',
    });
    respond(requests.at(-1)!, {
      ok: true,
      state,
      page: { items: [{ ...destination, id: 'second' }] },
    });
    await next;
    expect(manager.getSnapshot().movePicker?.items).toHaveLength(2);
    expect(manager.getSnapshot().folders).toEqual(root);
    manager.closeMove();
    expect(requests.some((req) => req.command.action === 'move')).toBe(false);
    manager.dispose();
  },
);

test.each<CloudProviderId>(['google-drive'])(
  '%s move uses the captured item and destination, and finishes through FileManager',
  async (provider) => {
    const { manager, files, requests, respond, state } = organizing(provider);
    manager.startMove(movable);
    respond(requests.at(-1)!, {
      ok: true,
      state,
      page: { items: [destination] },
    });
    await Promise.resolve();
    const navigate = manager.browseMove([
      { id: 'root', name: 'my_drive' },
      { id: 'folder', name: 'Drafts' },
    ]);
    respond(requests.at(-1)!, { ok: true, state, page: { items: [] } });
    await navigate;
    const move = manager.confirmMove();
    const req = requests.at(-1)!;
    expect(req.command).toMatchObject({
      action: 'move',
      itemId: 'notes',
      sourceFolderId: 'root',
      folderId: 'folder',
      accountId: 'account',
    });
    expect(manager.getSnapshot().movePicker?.moving).toBe(true);
    manager.closeMove();
    expect(manager.getSnapshot().movePicker).toBeDefined();
    respond(req, {
      ok: true,
      state,
      item: { ...movable, parents: ['folder'] },
      previousValidator: '"old"',
    });
    await move;
    expect(files.moveRemoteDocument).toHaveBeenCalledWith(
      expect.objectContaining({ item: movable, provider }),
      expect.any(Function),
    );
    expect(manager.getSnapshot().movePicker).toBeUndefined();
    manager.dispose();
  },
);

describe.each(['create', 'createFolder'] as const)(
  '%s duplicate warnings',
  (kind) => {
    test.each([false, true])(
      'warns without offering to recreate the confirmed item (recovered: %s)',
      async (recovered) => {
        const { manager, files, requests, respond, fail, state } =
          organizing('google-drive');
        jest
          .mocked(openPromptExternal)
          .mockResolvedValueOnce({ button: 'confirm', value: 'New.md' });
        let pending =
          kind === 'create' ? manager.create() : manager.createFolder();
        await Promise.resolve();
        if (recovered) {
          fail(requests.at(-1)!, 'unconfirmed');
          await pending;
          jest.mocked(sonnerToast).mockClear();
          pending =
            kind === 'create'
              ? manager.reconcileCreate()
              : manager.reconcileItem();
        }
        const item = {
          id: 'own-id',
          name: 'New.md',
          kind: kind === 'create' ? ('markdown' as const) : ('folder' as const),
          parents: ['root'],
          nameConflict: true,
        };
        respond(requests.at(-1)!, {
          ok: true,
          state,
          ...(kind === 'create'
            ? {
                document: {
                  provider: 'google-drive',
                  connectionId: 'drive',
                  accountId: 'account',
                  connectionName: 'Drive',
                  content: '',
                  item,
                },
              }
            : { item }),
        });
        await pending;
        expect(sonnerToast).toHaveBeenCalledTimes(1);
        expect(sonnerToast).toHaveBeenCalledWith(
          'warning',
          'cloud:created_duplicate',
        );
        if (kind === 'create')
          expect(files.openRemoteDocument).toHaveBeenCalledWith(
            expect.objectContaining({
              item: expect.objectContaining({
                id: 'own-id',
                nameConflict: true,
              }),
            }),
          );
        expect(manager.getSnapshot().pendingCreate).toBeUndefined();
        expect(manager.getSnapshot().pendingItem).toBeUndefined();
        manager.dispose();
      },
    );
  },
);

test('Dropbox moves stay disabled while folder creation remains available', async () => {
  const { manager, requests } = organizing('dropbox');
  const count = requests.length;
  expect(manager.canMove(movable)).toBe(false);
  expect(manager.canOrganize()).toBe(true);
  manager.startMove(movable);
  await manager.confirmMove();
  expect(manager.getSnapshot().movePicker).toBeUndefined();
  expect(requests).toHaveLength(count);
  manager.dispose();
});

test('a closed or disconnected picker ignores late folder replies and read-only items cannot move', async () => {
  const { manager, requests, respond, state, push } = organizing();
  expect(manager.canMove({ ...movable, shortcut: true })).toBe(false);
  expect(manager.canMove({ ...movable, driveId: 'shared' })).toBe(false);
  manager.startMove(movable);
  const req = requests.at(-1)!;
  push({
    ...state,
    revision: 2,
    connections: [{ ...state.connections[0], status: 'disconnected' }],
  });
  respond(req, { ok: true, state, page: { items: [destination] } });
  await Promise.resolve();
  expect(manager.getSnapshot().movePicker).toBeUndefined();
  expect(manager.canMove(movable)).toBe(false);
  manager.dispose();
});

test('unchanged cloud states do not continuously retry failed recovery reads', () => {
  const { manager, files, state, push } = setup();
  push(state);
  expect(files.checkRecoveredRemoteDocuments).toHaveBeenCalledTimes(1);
  push(state);
  push({ ...state, revision: 2 });
  expect(files.checkRecoveredRemoteDocuments).toHaveBeenCalledTimes(1);
  push({
    ...state,
    revision: 3,
    connections: [{ ...state.connections[0], status: 'disconnected' }],
  });
  push({ ...state, revision: 4 });
  expect(files.checkRecoveredRemoteDocuments).toHaveBeenCalledTimes(2);
  manager.dispose();
});
