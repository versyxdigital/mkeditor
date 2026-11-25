/** @jest-environment node */
import { CloudService } from '../src/app/lib/cloud/CloudService';
import { GoogleDrive } from '../src/app/lib/cloud/GoogleDrive';
import type { CloudPersistence } from '../src/app/lib/cloud/CloudStore';
import type { CloudCommand, CloudState } from '../src/app/interfaces/Cloud';
import { driveFixture } from './fixtures/driveServer';
import { CloudRecoveryStore } from '../src/app/lib/cloud/CloudRecoveryStore';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { safeStorage } from 'electron';

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
  expect(
    await request({ ...save, operationId: 'deleted-file-attempt' }),
  ).toMatchObject({ ok: false, error: 'missing' });
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

test('creates a folder once, checks duplicates and binds the operation to the account', async () => {
  const { id } = await editingConnection();
  const command = {
    action: 'createFolder' as const,
    connectionId: id,
    accountId: 'account-a',
    folderId: 'root',
    name: 'Drafts',
    operationId: 'folder-1',
  };
  expect(await request({ ...command, accountId: 'other' })).toMatchObject({
    ok: false,
    error: 'auth',
  });
  expect(await request(command)).toMatchObject({
    ok: true,
    item: { name: 'Drafts', kind: 'folder', parents: ['root'] },
  });
  expect(await request(command)).toMatchObject({ ok: true });
  const writes = fixture.calls.filter(
    (call) => call.method === 'POST' && call.url.pathname === '/drive/v3/files',
  );
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0].body)).toMatchObject({
    mimeType: 'application/vnd.google-apps.folder',
    name: 'Drafts',
  });
  expect(await request({ ...command, name: 'Different' })).toMatchObject({
    ok: false,
    error: 'configuration',
  });
  fixture.state.duplicate = true;
  expect(await request({ ...command, operationId: 'folder-2' })).toMatchObject({
    ok: false,
    error: 'duplicate',
  });
});

test('lost folder acknowledgement is reconciled by generated ID and marker, without replay', async () => {
  const { id } = await editingConnection();
  fixture.state.loseWrite = true;
  const command = {
    action: 'createFolder' as const,
    connectionId: id,
    accountId: 'account-a',
    folderId: 'root',
    name: 'Drafts',
    operationId: 'folder-lost',
  };
  expect(await request(command)).toMatchObject({
    ok: false,
    error: 'unconfirmed',
  });
  expect(await request(command)).toMatchObject({
    ok: false,
    error: 'unconfirmed',
  });
  expect(
    await request({
      action: 'reconcileItem',
      connectionId: id,
      accountId: 'account-a',
      operationId: command.operationId,
    }),
  ).toMatchObject({ ok: true, item: { name: 'Drafts', kind: 'folder' } });
  expect(
    fixture.calls.filter(
      (call) =>
        call.method === 'POST' && call.url.pathname === '/drive/v3/files',
    ),
  ).toHaveLength(1);
});

test('moves only metadata with a conditional request, preserving file identity and content', async () => {
  const { id, document } = await editingConnection();
  const command = {
    action: 'move' as const,
    connectionId: id,
    accountId: 'account-a',
    itemId: 'markdown',
    sourceFolderId: 'root',
    folderId: 'folder',
    operationId: 'move-1',
  };
  expect(await request(command)).toMatchObject({
    ok: true,
    previousValidator: document.item.validator,
    item: {
      id: 'markdown',
      parents: ['folder'],
      validator: '"etag-2"',
      contentRevision: document.item.contentRevision,
    },
  });
  expect(fixture.state.content).toBe(document.content);
  expect(await request(command)).toMatchObject({ ok: true });
  const patches = fixture.calls.filter((call) => call.method === 'PATCH');
  expect(patches).toHaveLength(1);
  expect(patches[0]).toMatchObject({
    body: '{}',
    ifMatch: document.item.validator,
  });
  expect(patches[0].url.searchParams.get('addParents')).toBe('folder');
  expect(patches[0].url.searchParams.get('removeParents')).toBe('root');
});

test('lost move response is checked without replaying the move or writing contents', async () => {
  const { id, document } = await editingConnection();
  fixture.state.loseWrite = true;
  const command = {
    action: 'move' as const,
    connectionId: id,
    accountId: 'account-a',
    itemId: 'markdown',
    sourceFolderId: 'root',
    folderId: 'folder',
    operationId: 'move-lost',
  };
  expect(await request(command)).toMatchObject({
    ok: false,
    error: 'unconfirmed',
  });
  expect(
    await request({ ...command, operationId: 'move-again' }),
  ).toMatchObject({ ok: false, error: 'pending_operation' });
  expect(
    await request({
      action: 'reconcileItem',
      connectionId: id,
      accountId: 'account-a',
      operationId: command.operationId,
    }),
  ).toMatchObject({ ok: true, item: { id: 'markdown', parents: ['folder'] } });
  expect(fixture.calls.filter((call) => call.method === 'PATCH')).toHaveLength(
    1,
  );
  expect(fixture.state.content).toBe(document.content);
});

test('organization refuses read-only grants, shared drives, invalid names and stale source folders', async () => {
  const id = await add();
  await authorizeConnection(id);
  const create = {
    action: 'createFolder' as const,
    connectionId: id,
    accountId: 'account-a',
    folderId: 'root',
    name: 'Folder',
    operationId: 'no-write',
  };
  expect(await request(create)).toMatchObject({
    ok: false,
    error: 'permission',
  });
  fixture.state.scopes += ' https://www.googleapis.com/auth/drive';
  await authorizeConnection(id, true);
  for (const name of ['', '..', 'a/b', 'a\\b', 'bad\nname']) {
    expect(await request({ ...create, name })).toMatchObject({
      ok: false,
      error: 'configuration',
    });
  }
  const move = {
    action: 'move' as const,
    connectionId: id,
    accountId: 'account-a',
    itemId: 'markdown',
    sourceFolderId: 'folder',
    folderId: 'root',
    operationId: 'move',
  };
  expect(await request(move)).toMatchObject({ ok: false, error: 'conflict' });
  fixture.state.shared = true;
  expect(await request(create)).toMatchObject({
    ok: false,
    error: 'unsupported',
  });
  expect(
    await request({ ...move, sourceFolderId: 'root', folderId: 'folder' }),
  ).toMatchObject({ ok: false, error: 'unsupported' });
  expect(fixture.calls.filter((call) => call.method === 'PATCH')).toHaveLength(
    0,
  );
});

test('moves serialize behind saves to the same file and keep the newly saved contents', async () => {
  const { id, save } = await editingConnection();
  let release!: () => void;
  fixture.state.writeWait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saving = request(save);
  for (
    let attempt = 0;
    attempt < 100 && !fixture.calls.some((call) => call.method === 'PUT');
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(fixture.calls.some((call) => call.method === 'PUT')).toBe(true);
  const moving = request({
    action: 'move',
    connectionId: id,
    accountId: 'account-a',
    itemId: 'markdown',
    sourceFolderId: 'root',
    folderId: 'folder',
    operationId: 'queued-move',
  });
  expect(fixture.calls.some((call) => call.method === 'PATCH')).toBe(false);
  release();
  expect(await saving).toMatchObject({ ok: true });
  expect(await moving).toMatchObject({
    ok: true,
    previousValidator: '"etag-2"',
    item: { parents: ['folder'] },
  });
  expect(fixture.state.content).toBe(save.content);
});

async function journalRun(
  work: (restart: () => void, store: () => CloudRecoveryStore) => Promise<void>,
) {
  const root = mkdtempSync(join(tmpdir(), 'mkeditor-journal-'));
  const path = join(root, 'journal.bin');
  const store = () => new CloudRecoveryStore(path);

  const restart = () => {
    service.dispose();
    service = new CloudService(
      persistence,
      async (url) => {
        authorize = new URL(url);
      },
      (state) => pushes.push(state),
      new GoogleDrive(fixture.endpoints),
      sharedRegistration,
      store(),
    );
  };
  try {
    restart();
    await work(restart, store);
  } finally {
    service.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

test('a lost save acknowledgement survives a main-process restart without a replay', async () => {
  const { id, save } = await editingConnection();
  await journalRun(async (restart) => {
    fixture.state.loseWrite = true;
    expect(await request(save)).toMatchObject({
      ok: false,
      error: 'unconfirmed',
    });
    restart();
    expect((await service.state()).pendingOperations).toEqual([
      expect.objectContaining({ operationId: save.operationId, kind: 'save' }),
    ]);
    expect(
      await request({
        action: 'reconcile',
        connectionId: id,
        accountId: 'account-a',
        operationId: save.operationId,
      }),
    ).toMatchObject({ ok: true, document: { content: save.content } });
    expect(fixture.calls.filter((call) => call.method === 'PUT')).toHaveLength(
      1,
    );
  });
});

test('a lost creation acknowledgement is reconciled by its durable generated identity after restart', async () => {
  const { id } = await editingConnection();
  await journalRun(async (restart) => {
    fixture.state.loseWrite = true;
    const command = {
      action: 'create' as const,
      connectionId: id,
      accountId: 'account-a',
      folderId: 'root',
      name: 'Recovery.md',
      content: 'recovered copy',
      operationId: 'create-crash',
    };
    expect(await request(command)).toMatchObject({
      ok: false,
      error: 'unconfirmed',
    });
    restart();
    expect(
      await request({
        action: 'reconcile',
        connectionId: id,
        accountId: 'account-a',
        operationId: command.operationId,
      }),
    ).toMatchObject({ ok: true, document: { content: command.content } });
    expect(
      fixture.calls.filter(
        (call) =>
          call.method === 'POST' && call.url.pathname.startsWith('/upload/'),
      ),
    ).toHaveLength(1);
  });
});

describe.each(['create', 'createFolder'] as const)(
  'concurrent name during %s',
  (kind) => {
    test.each([false, true])(
      'keeps its generated ID and warning across restart (lost reply: %s)',
      async (lost) => {
        const { id } = await editingConnection();
        await journalRun(async (restart, store) => {
          let release!: () => void;
          fixture.state.writeWait = new Promise<void>((resolve) => {
            release = resolve;
          });
          fixture.state.loseWrite = lost;
          const command: CloudCommand =
            kind === 'create'
              ? {
                  action: 'create',
                  connectionId: id,
                  accountId: 'account-a',
                  folderId: 'root',
                  name: 'New.md',
                  content: 'own contents',
                  operationId: 'same-name-file',
                }
              : {
                  action: 'createFolder',
                  connectionId: id,
                  accountId: 'account-a',
                  folderId: 'root',
                  name: 'New',
                  operationId: 'same-name-folder',
                };
          const before = fixture.calls.filter(
            (call) => call.method === 'POST',
          ).length;
          const pending = request(command);
          try {
            for (
              let attempt = 0;
              attempt < 200 &&
              fixture.calls.filter((call) => call.method === 'POST').length ===
                before;
              attempt++
            )
              await new Promise((resolve) => setTimeout(resolve, 2));
            expect(
              fixture.calls.filter((call) => call.method === 'POST'),
            ).toHaveLength(before + 1);
            fixture.state.duplicate = true;
            release();
            const response = await pending;
            if (lost)
              expect(response).toMatchObject({
                ok: false,
                error: 'unconfirmed',
              });
            else
              expect(response).toMatchObject(
                kind === 'create'
                  ? {
                      ok: true,
                      document: {
                        item: { id: 'created-id', nameConflict: true },
                      },
                    }
                  : {
                      ok: true,
                      item: { id: 'created-id', nameConflict: true },
                    },
              );
            restart();
            const check: CloudCommand = {
              action: kind === 'create' ? 'reconcile' : 'reconcileItem',
              connectionId: id,
              accountId: 'account-a',
              operationId: command.operationId,
            };
            if (lost) {
              fixture.state.override = (url, response) => {
                if (
                  !url.searchParams.get('fields')?.includes('incompleteSearch')
                )
                  return false;
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(
                  JSON.stringify({ files: [], incompleteSearch: true }),
                );
                return true;
              };
              expect(await request(check)).toMatchObject({
                ok: false,
                error: 'unconfirmed',
              });
              expect(await request(check)).toMatchObject({
                ok: false,
                error: 'unconfirmed',
              });
              fixture.state.override = undefined;
            }
            expect(await request(check)).toMatchObject(
              kind === 'create'
                ? {
                    ok: true,
                    document: {
                      item: { id: 'created-id', nameConflict: true },
                    },
                  }
                : { ok: true, item: { id: 'created-id', nameConflict: true } },
            );
            const saved = (await store().load()).operations.find(
              (operation) => operation.operationId === command.operationId,
            );
            expect(
              kind === 'create'
                ? saved?.document?.item.nameConflict
                : saved?.item?.nameConflict,
            ).toBe(true);
            expect(await request(command)).toMatchObject({ ok: true });
            expect(
              fixture.calls.filter((call) => call.method === 'POST'),
            ).toHaveLength(before + 1);
            expect(
              fixture.calls.filter((call) => call.method === 'DELETE'),
            ).toEqual([]);
          } finally {
            release();
            await pending;
          }
        });
      },
    );
  },
);

test('an interrupted move is read back after restart and never sent twice', async () => {
  const { id } = await editingConnection();
  await journalRun(async (restart) => {
    fixture.state.loseWrite = true;
    const command = {
      action: 'move' as const,
      connectionId: id,
      accountId: 'account-a',
      itemId: 'markdown',
      sourceFolderId: 'root',
      folderId: 'folder',
      operationId: 'move-crash',
    };
    expect(await request(command)).toMatchObject({
      ok: false,
      error: 'unconfirmed',
    });
    restart();
    expect(
      await request({
        action: 'reconcileItem',
        connectionId: id,
        accountId: 'account-a',
        operationId: command.operationId,
      }),
    ).toMatchObject({ ok: true, item: { parents: ['folder'] } });
    expect(
      fixture.calls.filter((call) => call.method === 'PATCH'),
    ).toHaveLength(1);
  });
});

test('failure to persist a write intention prevents the provider write', async () => {
  const { save } = await editingConnection();
  await journalRun(async () => {
    jest
      .mocked(safeStorage.encryptStringAsync)
      .mockRejectedValueOnce(new Error('locked'));
    expect(await request(save)).toMatchObject({ ok: false, error: 'storage' });
    expect(fixture.calls.filter((call) => call.method === 'PUT')).toHaveLength(
      0,
    );
    expect(fixture.state.content).toBe('# Remote Markdown');
  });
});

test('a persisted save that never reached Drive is classified without retrying it', async () => {
  const { id, save } = await editingConnection();
  await journalRun(async (restart, store) => {
    await store().saveOperations([
      {
        operationId: save.operationId,
        connectionId: id,
        accountId: 'account-a',
        itemId: 'markdown',
        kind: 'save',
        content: save.content,
        validator: save.validator,
      },
    ]);
    restart();
    expect(
      await request({
        action: 'reconcile',
        connectionId: id,
        accountId: 'account-a',
        operationId: save.operationId,
      }),
    ).toMatchObject({ ok: false, error: 'not_applied' });
    expect(fixture.calls.filter((call) => call.method === 'PUT')).toHaveLength(
      0,
    );
    expect(
      await request({ ...save, operationId: 'explicit-new-save' }),
    ).toMatchObject({ ok: true });
  });
});
