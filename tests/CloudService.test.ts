/** @jest-environment node */
import { CloudService } from '../src/app/lib/cloud/CloudService';
import { GoogleDrive } from '../src/app/lib/cloud/GoogleDrive';
import type { CloudPersistence } from '../src/app/lib/cloud/CloudStore';
import type { CloudCommand, CloudState } from '../src/app/interfaces/Cloud';
import { driveFixture } from './fixtures/driveServer';

let fixture: Awaited<ReturnType<typeof driveFixture>>;
let service: CloudService;
let data: ReturnType<CloudPersistence['load']>;
let pushes: CloudState[];
let authorize: URL | undefined;
const request = (command: CloudCommand) =>
  service.handle({ requestId: 'test', command });
let persistence: CloudPersistence;
const sharedRegistration = {
  clientId: 'mkeditor-fixture.apps.googleusercontent.com',
  clientValue: 'public-fixture-default',
};

beforeEach(async () => {
  fixture = await driveFixture();
  data = [];
  pushes = [];
  authorize = undefined;
  persistence = {
    load: () => data,
    save: (value) => {
      data = value;
    },
    available: async () => true,
    encrypt: async (tokens) => JSON.stringify(tokens),
    decrypt: async (encoded) => JSON.parse(encoded),
  };
  service = new CloudService(
    persistence,
    async (url) => {
      authorize = new URL(url);
    },
    (state) => {
      pushes.push(state);
    },
    new GoogleDrive(fixture.endpoints),
    sharedRegistration,
  );
});
afterEach(async () => {
  service.dispose();
  await fixture.close();
});

async function add() {
  const response = await request({
    action: 'add',
    name: 'My Drive',
    clientId: 'fixture.apps.googleusercontent.com',
    clientValue: 'desktop-public',
  });
  if (!response.ok) throw new Error(response.error);
  return response.state.connections.at(-1)!.id;
}
async function waitForBrowser() {
  for (let i = 0; i < 100 && !authorize; i++)
    await new Promise((resolve) => setTimeout(resolve, 2));
  if (!authorize) throw new Error('Browser did not open');
}
async function authorizeConnection(id: string, writeAccess?: boolean) {
  authorize = undefined;
  const pending = request({ action: 'connect', connectionId: id, writeAccess });
  await waitForBrowser();
  const callback = new URL(authorize!.searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({
    state: authorize!.searchParams.get('state')!,
    code: 'fixture-code',
  }).toString();
  await fetch(callback);
  return pending;
}

async function editingConnection() {
  const id = await add();
  fixture.state.scopes += ' https://www.googleapis.com/auth/drive';
  expect(await authorizeConnection(id, true)).toMatchObject({ ok: true });
  const result = await request({
    action: 'open',
    connectionId: id,
    accountId: 'account-a',
    itemId: 'markdown',
  });
  if (!result.ok || !result.document) throw new Error('Open failed');
  return {
    id,
    document: result.document,
    save: {
      action: 'save' as const,
      connectionId: id,
      accountId: 'account-a',
      itemId: 'markdown',
      validator: result.document.item.validator!,
      content: 'saved snapshot',
      operationId: 'write-1',
    },
  };
}

test('editing is explicit; missing write grant preserves the read-only connection', async () => {
  const id = await add();
  await authorizeConnection(id);
  const credential = data[0].credential;
  expect(await authorizeConnection(id, true)).toMatchObject({
    ok: false,
    error: 'permission',
  });
  expect(authorize!.searchParams.get('scope')).toContain(
    'https://www.googleapis.com/auth/drive',
  );
  expect(data[0].credential).toBe(credential);
  expect(data[0].writeAccess).toBe(false);
  expect(
    await request({
      action: 'save',
      connectionId: id,
      accountId: 'account-a',
      itemId: 'markdown',
      validator: '"etag-1"',
      content: 'no',
      operationId: 'no',
    }),
  ).toMatchObject({ ok: false, error: 'permission' });
});

test('conditional save updates by ID, deduplicates acknowledgements, and rejects stale content', async () => {
  const { save } = await editingConnection();
  expect(await request(save)).toMatchObject({
    ok: true,
    document: { content: save.content, item: { validator: '"etag-2"' } },
  });
  expect(await request(save)).toMatchObject({ ok: true });
  fixture.state.content = 'external edit';
  fixture.state.revision = '3';
  expect(await request({ ...save, operationId: 'write-2' })).toMatchObject({
    ok: false,
    error: 'conflict',
  });
  expect(fixture.state.content).toBe('external edit');
  expect(fixture.calls.filter((call) => call.method === 'POST')).toHaveLength(
    1,
  ); // OAuth only; saves never recreate.
  expect(fixture.calls.filter((call) => call.method === 'PUT')).toHaveLength(2);
});

test('lost save acknowledgement is not replayed and reconciles its frozen snapshot', async () => {
  const { id, save } = await editingConnection();
  fixture.state.loseWrite = true;
  expect(await request(save)).toMatchObject({
    ok: false,
    error: 'unconfirmed',
  });
  expect(fixture.state.content).toBe(save.content);
  expect(await request(save)).toMatchObject({
    ok: false,
    error: 'unconfirmed',
  });
  expect(fixture.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  expect(
    await request({
      action: 'reconcile',
      connectionId: id,
      accountId: 'account-a',
      operationId: save.operationId,
    }),
  ).toMatchObject({ ok: true, document: { content: save.content } });
});

test('overlapping saves serialize and a disconnect prevents queued writes without restoring credentials', async () => {
  const { id, save } = await editingConnection();
  let release!: () => void;
  fixture.state.writeWait = new Promise((resolve) => {
    release = resolve;
  });
  const first = request(save);
  for (
    let attempt = 0;
    attempt < 100 && !fixture.calls.some((call) => call.method === 'PUT');
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 2));
  const second = request({ ...save, operationId: 'queued', content: 'queued' });
  await request({ action: 'disconnect', connectionId: id });
  release();
  expect(await first).toMatchObject({
    ok: true,
    document: { accountId: 'account-a', content: save.content },
  });
  expect(await second).toMatchObject({ ok: false });
  expect(fixture.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  expect(data[0].credential).toBeUndefined();
  expect(data[0].accountId).toBeUndefined();
});

test('shared-drive and deleted files cannot be written; account changes do not retarget saves', async () => {
  const { save } = await editingConnection();
  fixture.state.shared = true;
  expect(await request(save)).toMatchObject({
    ok: false,
    error: 'unsupported',
  });
  fixture.state.shared = false;
  fixture.state.trashed = true;
  expect(await request(save)).toMatchObject({ ok: false, error: 'missing' });
  fixture.state.trashed = false;
  expect(await request({ ...save, accountId: 'other' })).toMatchObject({
    ok: false,
    error: 'auth',
  });
  expect(fixture.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
});

test('create refuses collisions, preserves Unicode names, and reconciles a lost response by generated ID', async () => {
  const { id } = await editingConnection();
  const create = {
    action: 'create' as const,
    connectionId: id,
    accountId: 'account-a',
    folderId: 'root',
    name: '日記 café.md',
    content: '# new document',
    operationId: 'create-1',
  };
  fixture.state.duplicate = true;
  expect(await request(create)).toMatchObject({
    ok: false,
    error: 'duplicate',
  });
  expect(fixture.state.created).toBeUndefined();
  fixture.state.duplicate = false;
  fixture.state.loseWrite = true;
  expect(await request(create)).toMatchObject({
    ok: false,
    error: 'unconfirmed',
  });
  expect(await request(create)).toMatchObject({
    ok: false,
    error: 'unconfirmed',
  });
  expect(fixture.state.created).toMatchObject({
    id: 'created-id',
    name: create.name,
  });
  expect(
    fixture.calls.filter((call) => call.url.pathname.startsWith('/upload/')),
  ).toHaveLength(1);
  expect(
    await request({
      action: 'reconcile',
      connectionId: id,
      accountId: 'account-a',
      operationId: create.operationId,
    }),
  ).toMatchObject({
    ok: true,
    document: {
      content: create.content,
      item: { id: 'created-id', name: create.name },
    },
  });
});

test('real adapter connects, tests, browses and opens; no tokens appear in public messages', async () => {
  const id = await add();
  expect((await authorizeConnection(id)).ok).toBe(true);
  expect((await request({ action: 'test', connectionId: id })).ok).toBe(true);
  const listing = await request({
    action: 'list',
    connectionId: id,
    folderId: 'root',
  });
  expect(listing).toMatchObject({ ok: true, page: { nextPage: 'second' } });
  const open = await request({
    action: 'open',
    connectionId: id,
    itemId: 'markdown',
  });
  expect(open).toMatchObject({
    ok: true,
    document: {
      connectionId: id,
      accountId: 'account-a',
      content: '# Remote Markdown',
    },
  });
  expect(JSON.stringify([pushes, open, listing])).not.toMatch(
    /fixture-access|fixture-refresh|credential/,
  );
  await request({ action: 'rename', connectionId: id, name: 'Renamed' });
  expect((await service.state()).connections[0].name).toBe('Renamed');
  await request({ action: 'disconnect', connectionId: id });
  expect(data[0].credential).toBeUndefined();
  expect((await service.state()).connections[0]).toMatchObject({
    status: 'disconnected',
    name: 'Renamed',
  });
  expect((await service.state()).connections[0].accountName).toBeUndefined();
  expect(
    await request({ action: 'open', connectionId: id, itemId: 'markdown' }),
  ).toMatchObject({ ok: false, error: 'auth' });
  await request({ action: 'remove', connectionId: id });
  expect(data).toHaveLength(0);
});

test('one-click connection uses the bundled app, authorizes immediately, and returns its identity', async () => {
  const pending = request({
    action: 'add',
    name: 'Google Drive',
    authorize: true,
  });
  await waitForBrowser();
  expect(authorize!.searchParams.get('client_id')).toBe(
    sharedRegistration.clientId,
  );
  expect((await service.state()).connections[0]).toMatchObject({
    registration: 'mkeditor',
    status: 'connecting',
  });
  const callback = new URL(authorize!.searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({
    state: authorize!.searchParams.get('state')!,
    code: 'fixture-code',
  }).toString();
  await fetch(callback);
  const result = await pending;
  expect(result).toMatchObject({
    ok: true,
    connectionId: data[0].id,
    state: {
      googleDriveAvailable: true,
      connections: [
        { status: 'connected', accountId: 'account-a', name: 'Google Drive' },
      ],
    },
  });
  expect(fixture.state.tokenForm!.get('client_secret')).toBe(
    sharedRegistration.clientValue,
  );
  expect(JSON.stringify(result)).not.toMatch(/fixture-access|fixture-refresh/);
});

test('missing bundled registration blocks the default flow but preserves the custom-app option', async () => {
  service.dispose();
  service = new CloudService(
    persistence,
    async (url) => {
      authorize = new URL(url);
    },
    (state) => {
      pushes.push(state);
    },
    new GoogleDrive(fixture.endpoints),
    null,
  );
  expect((await service.state()).googleDriveAvailable).toBe(false);
  expect(
    await request({ action: 'add', name: 'Google Drive', authorize: true }),
  ).toMatchObject({ ok: false, error: 'configuration' });
  expect(data).toHaveLength(0);
  const id = await add();
  expect((await authorizeConnection(id)).ok).toBe(true);
  expect(authorize!.searchParams.get('client_id')).toBe(
    'fixture.apps.googleusercontent.com',
  );
  expect(data[0].registration).toBe('custom');
});

test('cancelling one-click sign-in preserves existing connections and leaves no new account credentials', async () => {
  const existing = await add();
  await authorizeConnection(existing);
  authorize = undefined;
  const pending = request({
    action: 'add',
    name: 'Google Drive',
    authorize: true,
  });
  await waitForBrowser();
  const added = data.find((entry) => entry.id !== existing)!;
  await request({ action: 'disconnect', connectionId: added.id });
  expect(await pending).toMatchObject({ ok: false, error: 'cancelled' });
  expect(data.find((entry) => entry.id === added.id)).toMatchObject({
    status: 'disconnected',
  });
  expect(
    data.find((entry) => entry.id === added.id)?.credential,
  ).toBeUndefined();
  expect(data.find((entry) => entry.id === existing)).toMatchObject({
    status: 'connected',
    accountId: 'account-a',
  });
});

test('legacy connections keep their registration and credentials when the bundled app changes', async () => {
  const id = await add();
  await authorizeConnection(id);
  delete data[0].registration;
  const credential = data[0].credential;
  service.dispose();
  service = new CloudService(
    persistence,
    async (url) => {
      authorize = new URL(url);
    },
    (state) => {
      pushes.push(state);
    },
    new GoogleDrive(fixture.endpoints),
    sharedRegistration,
  );
  expect((await request({ action: 'test', connectionId: id })).ok).toBe(true);
  expect(data[0].credential).toBe(credential);
  expect((await authorizeConnection(id)).ok).toBe(true);
  expect(authorize!.searchParams.get('client_id')).toBe(
    'fixture.apps.googleusercontent.com',
  );
});

test('refresh coalesces, persists rotation and revoked refresh requires reauthorization', async () => {
  data.push({
    id: 'existing',
    name: 'Drive',
    clientId: 'fixture.apps.googleusercontent.com',
    clientValue: '',
    accountId: 'account-a',
    status: 'connected',
    credential: JSON.stringify({
      access: 'old',
      refresh: 'fixture-refresh',
      expires: 0,
    }),
  });
  const results = await Promise.all([
    request({ action: 'test', connectionId: 'existing' }),
    request({ action: 'list', connectionId: 'existing', folderId: 'root' }),
  ]);
  expect(results.every((response) => response.ok)).toBe(true);
  expect(fixture.state.refreshes).toBe(1);
  expect(data[0].credential).toContain('fixture-access');
  service.dispose();
  data[0].credential = JSON.stringify({
    access: 'old',
    refresh: 'fixture-refresh',
    expires: 0,
  });
  service = new CloudService(
    persistence,
    async () => {},
    (state) => pushes.push(state),
    new GoogleDrive(fixture.endpoints),
  );
  fixture.state.revoked = true;
  expect(
    await request({ action: 'test', connectionId: 'existing' }),
  ).toMatchObject({ ok: false, error: 'auth' });
  expect(data[0].status).toBe('reauthorize');
  expect(data[0].credential).toBeUndefined();
});

test.each(['disconnect', 'remove'] as const)(
  '%s while refresh is in flight cannot restore credentials or return content',
  async (action) => {
    data.push({
      id: 'existing',
      name: 'Drive',
      clientId: 'fixture.apps.googleusercontent.com',
      clientValue: '',
      accountId: 'account-a',
      status: 'connected',
      credential: JSON.stringify({
        access: 'old',
        refresh: 'fixture-refresh',
        expires: 0,
      }),
    });
    let release!: () => void;
    fixture.state.refreshWait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = request({
      action: 'open',
      connectionId: 'existing',
      itemId: 'markdown',
    });
    while (!fixture.state.refreshes)
      await new Promise((resolve) => setTimeout(resolve, 2));
    await request({ action, connectionId: 'existing' });
    release();
    expect(await pending).toMatchObject({ ok: false, error: 'cancelled' });
    expect(data.every((entry) => !entry.credential)).toBe(true);
    expect(JSON.stringify(pushes.at(-1))).not.toContain('account-a');
  },
);

test('disconnect cancels a pending browser login and account changes retain independent document identities', async () => {
  const id = await add();
  const pending = request({ action: 'connect', connectionId: id });
  await waitForBrowser();
  await request({ action: 'disconnect', connectionId: id });
  expect(await pending).toMatchObject({ ok: false, error: 'cancelled' });
  await authorizeConnection(id);
  const first = await request({
    action: 'open',
    connectionId: id,
    itemId: 'markdown',
  });
  fixture.state.accountId = 'account-b';
  await authorizeConnection(id);
  const second = await request({
    action: 'open',
    connectionId: id,
    itemId: 'markdown',
  });
  expect(first).toMatchObject({ document: { accountId: 'account-a' } });
  expect(second).toMatchObject({ document: { accountId: 'account-b' } });
});

test('secure storage unavailable blocks login; malformed commands cannot select endpoints or writes', async () => {
  persistence.available = async () => false;
  const id = await add();
  expect(await request({ action: 'connect', connectionId: id })).toMatchObject({
    ok: false,
    error: 'storage',
  });
  expect(authorize).toBeUndefined();
  expect(
    await service.handle({
      requestId: 'bad',
      command: {
        action: 'update',
        connectionId: id,
        endpoint: 'http://untrusted',
      },
    }),
  ).toMatchObject({ ok: false, error: 'configuration' });
});

test('failed credential deletion reports storage failure while blocking in-memory access', async () => {
  const id = await add();
  await authorizeConnection(id);
  persistence.save = () => {
    throw new (require('../src/app/lib/cloud/CloudError').CloudError)(
      'storage',
    );
  };
  expect(
    await request({ action: 'disconnect', connectionId: id }),
  ).toMatchObject({ ok: false, error: 'storage' });
  expect((await service.state()).connections[0]).toMatchObject({
    status: 'disconnected',
  });
  expect(
    await request({ action: 'open', connectionId: id, itemId: 'markdown' }),
  ).toMatchObject({ ok: false, error: 'auth' });
});

test('disconnect during the secure-storage probe cannot later start a browser login', async () => {
  const id = await add();
  let release!: (available: boolean) => void;
  const available = persistence.available;
  persistence.available = () =>
    new Promise<boolean>((resolve) => {
      release = resolve;
    });
  const pending = request({ action: 'connect', connectionId: id });
  persistence.available = available;
  await request({ action: 'disconnect', connectionId: id });
  release(true);
  expect(await pending).toMatchObject({ ok: false, error: 'cancelled' });
  expect(authorize).toBeUndefined();
});
