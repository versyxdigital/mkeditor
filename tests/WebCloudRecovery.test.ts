/** @jest-environment node */
import type { SessionPayload } from '../src/app/interfaces/Session';
import type { RemoteDocument } from '../src/app/interfaces/Cloud';
import type { CloudCommand } from '../src/app/interfaces/Cloud';
import { remoteDocumentPath } from '../src/app/interfaces/Cloud';
import { WebCloudRecoveryStore } from '../src/browser/core/cloud/WebCloudRecoveryStore';
import { WebCloudStore } from '../src/browser/core/cloud/WebCloudStore';
import { WebCloudService } from '../src/browser/core/cloud/WebCloudService';
import {
  browserAuth,
  browserOwnership,
  MemoryCloudStorage,
} from './utils/webCloud';

const document: RemoteDocument = {
  connectionId: 'connection',
  accountId: 'account-a',
  connectionName: 'Drive',
  item: {
    id: 'markdown',
    kind: 'markdown',
    name: 'notes.md',
    parents: ['root'],
    validator: '"1"',
    editable: true,
  },
  content: 'latest unsaved draft',
};
const session = (): SessionPayload => ({
  version: 3,
  activeFile: remoteDocumentPath(document),
  workspaceRoot: null,
  tabs: [
    {
      path: remoteDocumentPath(document),
      name: 'notes.md',
      viewState: null,
      remote: {
        epoch: 'epoch',
        sequence: 4,
        document,
        baseline: 'saved',
        dirty: true,
      },
    },
  ],
});
const operation = {
  operationId: 'save-1',
  connectionId: 'connection',
  accountId: 'account-a',
  itemId: 'markdown',
  kind: 'save' as const,
  content: 'write snapshot',
  validator: '"1"',
  epoch: 'epoch',
  sequence: 3,
};

function service(storage: Storage, owned = true) {
  return new WebCloudService(() => {}, {
    storage,
    auth: browserAuth().auth,
    ownership: browserOwnership(owned),
  });
}

test('the final synchronous checkpoint survives page replacement and retains unknown writes', async () => {
  const storage = new MemoryCloudStorage();
  const first = service(storage);
  await first.state();
  await first.recovery.saveOperations([operation]);
  first.saveSessionSync(session());
  first.dispose();
  const next = service(storage);
  const restored = await next.restoreSession(null);
  expect(restored?.tabs[0].remote).toMatchObject({
    dirty: true,
    document: { content: 'latest unsaved draft' },
    pendingSave: { operationId: 'save-1', content: 'write snapshot' },
  });
  expect((await next.recovery.load()).operations).toHaveLength(1);
  next.dispose();
});

test('a journal update and synchronous checkpoint preserve each other in both orders', async () => {
  const storage = new MemoryCloudStorage();
  const recovery = new WebCloudRecoveryStore(storage);
  const writing = recovery.saveOperations([operation]);
  recovery.saveSessionSync(session());
  await writing;
  await recovery.saveOperations([{ ...operation, document }]);
  recovery.saveSessionSync(session(), ['save-1']);
  const loaded = await recovery.load();
  expect(loaded.acknowledged).toContain('save-1');
  expect(loaded.operations).toEqual([]);
  expect(loaded.session).toMatchObject({
    tabs: [{ remote: { document: { content: 'latest unsaved draft' } } }],
  });
});

test('storage failure leaves the previous draft generation intact and does not acknowledge a write', async () => {
  const storage = new MemoryCloudStorage();
  const recovery = new WebCloudRecoveryStore(storage);
  recovery.saveSessionSync(session());
  const previous = storage.getItem('mkeditor-cloud-recovery');
  storage.failWrites = true;
  expect(() => recovery.saveSessionSync({ ...session(), tabs: [] })).toThrow(
    'storage',
  );
  await expect(recovery.saveOperations([operation])).rejects.toMatchObject({
    code: 'storage',
  });
  expect(storage.getItem('mkeditor-cloud-recovery')).toBe(previous);
  storage.failWrites = false;
  expect((await recovery.load()).operations).toEqual([]);
});

test('discarding an unknown write suppresses resurrection without deleting its operation evidence', async () => {
  const storage = new MemoryCloudStorage();
  const recovery = new WebCloudRecoveryStore(storage);
  await recovery.saveOperations([operation]);
  recovery.saveSessionSync(session());
  await recovery.discardDocument({
    connectionId: 'connection',
    accountId: 'account-a',
    itemId: 'markdown',
    operationIds: ['save-1'],
  });
  const next = service(storage);
  expect((await next.restoreSession(null))?.tabs).toEqual([]);
  expect((await next.recovery.load()).operations).toHaveLength(1);
  next.dispose();
});

test('clear tokens reject stale checkpoints and explicit resume restores persistence', async () => {
  const storage = new MemoryCloudStorage();
  const cloud = service(storage);
  await cloud.state();
  cloud.saveSessionSync(session());
  const token = await cloud.clearSession();
  cloud.saveSessionSync(session());
  expect((await cloud.recovery.load()).session).toBeUndefined();
  cloud.saveSessionSync({ ...session(), resumeAfterClear: token });
  expect((await cloud.restoreSession(null))?.tabs).toHaveLength(1);
  cloud.dispose();
});

test.each([true, false])(
  'clear also suppresses stale local-only checkpoints with cloud ownership: %p',
  async (owned) => {
    const cloud = service(new MemoryCloudStorage(), owned);
    await cloud.state();
    const local: SessionPayload = {
      version: 3,
      tabs: [
        {
          path: 'untitled-1',
          name: 'Draft',
          viewState: null,
          untitledContent: 'local draft',
        },
      ],
      activeFile: 'untitled-1',
      workspaceRoot: null,
    };
    try {
      expect(cloud.saveSessionSync(local)).toBe(true);
      const token = await cloud.clearSession();
      expect(cloud.saveSessionSync(local)).toBe(false);
      expect(cloud.saveSessionSync({ ...local, resumeAfterClear: token })).toBe(
        true,
      );
    } finally {
      cloud.dispose();
    }
  },
);

test.each(['replaced', 'closed', 'new-tab'] as const)(
  'independent local checkpoints override mixed cloud snapshots when a draft is %s',
  async (change) => {
    const storage = new MemoryCloudStorage();
    const oldLocal: SessionPayload = {
      version: 3,
      tabs: [
        {
          path: 'untitled-1',
          name: 'Draft',
          viewState: null,
          untitledContent: 'older local draft',
        },
      ],
      activeFile: 'untitled-1',
      workspaceRoot: null,
    };
    const owner = service(storage);
    await owner.state();
    owner.saveSessionSync({
      ...session(),
      tabs: [...session().tabs, ...oldLocal.tabs],
    });
    const ownerId = owner.checkpointId;
    const cloudGeneration = storage.getItem('mkeditor-cloud-recovery');
    const currentLocal: SessionPayload =
      change === 'closed'
        ? { ...oldLocal, tabs: [], activeFile: null }
        : {
            ...oldLocal,
            tabs: [
              {
                ...oldLocal.tabs[0],
                path: change === 'new-tab' ? 'untitled-2' : 'untitled-1',
                untitledContent: 'new independent local draft',
              },
            ],
            activeFile: change === 'new-tab' ? 'untitled-2' : 'untitled-1',
          };
    const secondary = service(storage, false);
    await secondary.state();
    expect(secondary.saveSessionSync(currentLocal, ownerId)).toBe(true);
    expect(secondary.checkpointId).not.toBe(ownerId);
    expect(storage.getItem('mkeditor-cloud-recovery')).toBe(cloudGeneration);
    owner.dispose();
    secondary.dispose();
    const next = service(storage);
    try {
      const restored = await next.restoreSession(
        currentLocal,
        secondary.checkpointId,
      );
      expect(restored?.tabs.filter((tab) => !tab.remote)).toEqual(
        currentLocal.tabs,
      );
      expect(restored?.tabs.filter((tab) => tab.remote)).toMatchObject([
        { remote: { document: { content: 'latest unsaved draft' } } },
      ]);
      expect(restored?.activeFile).toBe(remoteDocumentPath(document));
    } finally {
      next.dispose();
    }
  },
);

test('a failed local commit restores newer local edits from the preceding cloud checkpoint', async () => {
  const storage = new MemoryCloudStorage();
  const oldLocal: SessionPayload = {
    version: 3,
    tabs: [
      {
        path: 'untitled-1',
        name: 'Draft',
        viewState: null,
        untitledContent: 'older local draft',
      },
    ],
    activeFile: 'untitled-1',
    workspaceRoot: null,
  };
  const owner = service(storage);
  await owner.state();
  owner.saveSessionSync({
    ...session(),
    tabs: [...session().tabs, ...oldLocal.tabs],
  });
  const previousLocalId = owner.checkpointId;
  const latestLocal = {
    ...oldLocal.tabs[0],
    untitledContent: 'newer draft whose local write failed',
  };
  owner.saveSessionSync(
    { ...session(), tabs: [...session().tabs, latestLocal] },
    previousLocalId,
  );
  expect(owner.checkpointId).not.toBe(previousLocalId);
  owner.dispose();
  const next = service(storage);
  try {
    const restored = await next.restoreSession(oldLocal, previousLocalId);
    expect(restored?.tabs.find((tab) => !tab.remote)?.untitledContent).toBe(
      'newer draft whose local write failed',
    );
  } finally {
    next.dispose();
  }
});

test('a failed first local commit preserves its local draft in the cloud checkpoint fallback', async () => {
  const storage = new MemoryCloudStorage();
  const oldLocal: SessionPayload = {
    version: 3,
    tabs: [],
    activeFile: null,
    workspaceRoot: null,
  };
  const owner = service(storage);
  await owner.state();
  owner.saveSessionSync(
    {
      ...session(),
      tabs: [
        ...session().tabs,
        {
          path: 'untitled-1',
          name: 'Draft',
          viewState: null,
          untitledContent: 'first local commit failed',
        },
      ],
    },
    null,
  );
  owner.dispose();
  const next = service(storage);
  try {
    expect(
      (await next.restoreSession(oldLocal, null))?.tabs.find(
        (tab) => !tab.remote,
      )?.untitledContent,
    ).toBe('first local commit failed');
    expect(
      (
        await next.restoreSession(null, 'missing-or-corrupt-local-record')
      )?.tabs.find((tab) => !tab.remote)?.untitledContent,
    ).toBe('first local commit failed');
  } finally {
    next.dispose();
  }
});

test('local-only checkpoints still receive unique identities without browser crypto', async () => {
  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const cloud = service(new MemoryCloudStorage(), false);
  await cloud.state();
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: undefined,
  });
  try {
    const local: SessionPayload = {
      version: 3,
      tabs: [],
      activeFile: null,
      workspaceRoot: null,
    };
    expect(cloud.saveSessionSync(local)).toBe(true);
    const first = cloud.checkpointId;
    expect(first).toEqual(expect.any(String));
    expect(cloud.saveSessionSync(local, first)).toBe(true);
    expect(cloud.checkpointId).not.toBe(first);
  } finally {
    cloud.dispose();
    if (previousCrypto)
      Object.defineProperty(globalThis, 'crypto', previousCrypto);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
});

test('malformed recovery and inconsistent remote identities fail closed without replacing storage', async () => {
  const storage = new MemoryCloudStorage();
  storage.setItem('mkeditor-cloud-recovery', '{bad');
  const cloud = service(storage);
  await expect(cloud.restoreSession(null)).rejects.toMatchObject({
    code: 'storage',
  });
  expect(() => cloud.saveSessionSync(session())).toThrow('storage');
  expect(storage.getItem('mkeditor-cloud-recovery')).toBe('{bad');
  const invalid = session();
  invalid.tabs[0].path = 'cloud-drive://different/account/item';
  expect(() => cloud.saveSessionSync(invalid)).toThrow('storage');
  cloud.dispose();
});

test.each([false, true])(
  'invalid recovered session blocks journal mutations before or after bootstrap: %p',
  async (restoreFirst) => {
    const storage = new MemoryCloudStorage();
    const invalid = session();
    invalid.tabs[0].path = 'cloud-drive://different/account/item';
    const original = JSON.stringify({
      version: 1,
      operations: [],
      acknowledged: [],
      suppressedOperations: [],
      session: invalid,
    });
    storage.setItem('mkeditor-cloud-recovery', original);
    const cloud = service(storage);
    const network = jest.spyOn(globalThis, 'fetch');
    try {
      if (restoreFirst)
        await expect(cloud.restoreSession(null)).rejects.toMatchObject({
          code: 'storage',
        });
      const commands: CloudCommand[] = [
        {
          action: 'create',
          connectionId: 'connection',
          accountId: 'account-a',
          folderId: 'root',
          name: 'new.md',
          content: 'draft',
          operationId: 'create-1',
        },
        {
          action: 'save',
          connectionId: 'connection',
          accountId: 'account-a',
          itemId: 'markdown',
          validator: '"1"',
          content: 'draft',
          operationId: 'save-1',
        },
        { action: 'acknowledge', operationId: 'save-1' },
        {
          action: 'discardDocument',
          document: {
            connectionId: 'connection',
            accountId: 'account-a',
            itemId: 'markdown',
            operationIds: [],
          },
        },
      ];
      for (const command of commands)
        await expect(
          cloud.handle({ requestId: 'blocked', command }),
        ).resolves.toMatchObject({ ok: false, error: 'storage' });
      expect(() => cloud.saveSessionSync(session())).toThrow('storage');
      expect(storage.getItem('mkeditor-cloud-recovery')).toBe(original);
      expect(network).not.toHaveBeenCalled();
      expect(await cloud.state()).toMatchObject({ recoveryError: true });
      const token = await cloud.clearSession();
      cloud.saveSessionSync({ ...session(), resumeAfterClear: token });
      expect(
        (await cloud.restoreSession(null))?.tabs[0].remote?.document.content,
      ).toBe('latest unsaved draft');
      expect((await cloud.state()).recoveryError).toBeUndefined();
    } finally {
      cloud.dispose();
      network.mockRestore();
    }
  },
);

test('a second page cannot change cloud metadata, recovery, or credentials', async () => {
  const storage = new MemoryCloudStorage();
  const owner = service(storage);
  await owner.state();
  owner.saveSessionSync(session());
  const previous = storage.getItem('mkeditor-cloud-recovery');
  const secondary = service(storage, false);
  expect(await secondary.state()).toMatchObject({
    browserAccess: 'busy',
    secureStorage: false,
  });
  expect(
    await secondary.handle({
      requestId: 'add',
      command: { action: 'add', provider: 'dropbox', name: 'Dropbox' },
    }),
  ).toMatchObject({ ok: false, error: 'storage' });
  expect(() => secondary.saveSessionSync(session())).toThrow('storage');
  expect(() =>
    secondary.saveSessionSync({ ...session(), tabs: [], activeFile: null }),
  ).not.toThrow();
  await expect(secondary.clearSession()).rejects.toMatchObject({
    code: 'storage',
  });
  expect(storage.getItem('mkeditor-cloud-recovery')).toBe(previous);
  owner.dispose();
  secondary.dispose();
});

test('browsers without Web Locks preserve ordinary local session operations', async () => {
  const storage = new MemoryCloudStorage();
  const cloud = new WebCloudService(() => {}, {
    storage,
    auth: browserAuth().auth,
    ownership: new (
      await import('../src/browser/core/cloud/WebCloudLock')
    ).WebCloudLock(null),
  });
  const local = { ...session(), tabs: [], activeFile: null };
  expect(await cloud.restoreSession(local)).toEqual(local);
  cloud.saveSessionSync(local);
  expect(await cloud.clearSession()).toMatch(/^clear-/);
  expect(await cloud.state()).toMatchObject({ browserAccess: 'unavailable' });
  cloud.dispose();
});

test('tokens and opaque credential handles never enter durable browser metadata', async () => {
  const storage = new MemoryCloudStorage();
  const store = new WebCloudStore(storage);
  const handle = await store.encrypt({
    access: 'secret-access',
    refresh: 'secret-refresh',
    expires: Date.now() + 3600_000,
  });
  store.save([
    {
      id: 'connection',
      name: 'Drive',
      clientId: 'public.apps.googleusercontent.com',
      clientValue: '',
      status: 'connected',
      accountId: 'account-a',
      credential: handle,
    },
  ]);
  const raw = storage.getItem('mkeditor-cloud-connections')!;
  expect(raw).not.toContain('secret-');
  expect(raw).not.toContain(handle);
  expect(await store.decrypt(handle)).toMatchObject({
    access: 'secret-access',
    refresh: '',
  });
  expect(new WebCloudStore(storage).load()[0]).toMatchObject({
    status: 'reauthorize',
    accountId: 'account-a',
  });
  storage.failWrites = true;
  expect(() => store.save([])).toThrow('storage');
  await expect(store.decrypt(handle)).rejects.toMatchObject({ code: 'auth' });
});

test('a restricted localStorage getter cannot crash service construction', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('denied');
    },
  });
  let cloud: WebCloudService | undefined;
  try {
    expect(() => {
      cloud = new WebCloudService(() => {}, {
        auth: browserAuth().auth,
        ownership: browserOwnership(),
      });
    }).not.toThrow();
    await expect(
      cloud!.handle({ requestId: 'state', command: { action: 'state' } }),
    ).resolves.toMatchObject({ ok: false, error: 'storage' });
  } finally {
    cloud?.dispose();
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('exclusive browser ownership is held until release and a blocked page requires reload', async () => {
  let held = false;
  const locks = {
    async request(
      _name: string,
      _options: unknown,
      callback: (lock: unknown) => Promise<void>,
    ) {
      if (held) return callback(null);
      held = true;
      try {
        await callback({ name: 'cloud', mode: 'exclusive' });
      } finally {
        held = false;
      }
    },
  } as unknown as LockManager;
  const { WebCloudLock } =
    await import('../src/browser/core/cloud/WebCloudLock');
  const first = new WebCloudLock(locks);
  await first.ready;
  const blocked = new WebCloudLock(locks);
  await blocked.ready;
  expect(first.owned).toBe(true);
  expect(blocked.owned).toBe(false);
  first.dispose();
  await Promise.resolve();
  await Promise.resolve();
  const reloaded = new WebCloudLock(locks);
  await reloaded.ready;
  expect(reloaded.owned).toBe(true);
  expect(blocked.owned).toBe(false);
  blocked.dispose();
  reloaded.dispose();
});

test('browser policy denial of Web Locks fails closed without breaking the local editor', async () => {
  const { WebCloudLock } =
    await import('../src/browser/core/cloud/WebCloudLock');
  const locks = {
    request() {
      throw new Error('SecurityError');
    },
  } as unknown as LockManager;
  const cloud = new WebCloudService(() => {}, {
    storage: new MemoryCloudStorage(),
    auth: browserAuth().auth,
    ownership: new WebCloudLock(locks),
  });
  expect(await cloud.state()).toMatchObject({
    browserAccess: 'unavailable',
    secureStorage: false,
  });
  const local = { ...session(), tabs: [], activeFile: null };
  expect(await cloud.restoreSession(local)).toEqual(local);
  cloud.dispose();
});

test.each([false, true])(
  'pagehide synchronously checkpoints the last draft before disposal, even when flushing throws: %p',
  async (flushThrows) => {
    const previousWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      'window',
    );
    const listeners = new Map<string, EventListener>();
    const fakeWindow = {
      addEventListener: jest.fn((type: string, listener: EventListener) =>
        listeners.set(type, listener),
      ),

      removeEventListener: jest.fn((type: string) => listeners.delete(type)),

      location: { reload: jest.fn() },
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: fakeWindow,
    });
    const storage = new MemoryCloudStorage();
    const ownership = browserOwnership();
    const { auth } = browserAuth();
    let cloud: WebCloudService | undefined;
    try {
      cloud = new WebCloudService(() => {}, {
        storage,
        auth,
        ownership,
        beforeDispose: () => {
          cloud!.saveSessionSync(session());
          if (flushThrows) throw new Error('flush callback failed');
        },
      });
      await cloud.state();
      const pagehide = new Event('pagehide');
      Object.defineProperty(pagehide, 'persisted', { value: true });
      const dispatch = () => listeners.get('pagehide')!(pagehide);
      if (flushThrows) expect(dispatch).toThrow('flush callback failed');
      else expect(dispatch).not.toThrow();
      expect(
        new WebCloudRecoveryStore(storage).loadSync().session,
      ).toMatchObject({
        tabs: [{ remote: { document: { content: 'latest unsaved draft' } } }],
      });
      expect(auth.dispose).toHaveBeenCalled();
      expect(ownership.owned).toBe(false);
      expect(() => cloud!.saveSessionSync(session())).toThrow('cancelled');
      listeners.get('pageshow')!(new Event('pageshow'));
      expect(fakeWindow.location.reload).toHaveBeenCalledTimes(1);
    } finally {
      cloud?.dispose();
      if (previousWindow)
        Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  },
);
