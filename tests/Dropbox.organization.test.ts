/** @jest-environment node */
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Dropbox } from '../src/app/lib/cloud/Dropbox';
import { CloudService } from '../src/app/lib/cloud/CloudService';
import { CloudRecoveryStore } from '../src/app/lib/cloud/CloudRecoveryStore';
import type { CloudPersistence } from '../src/app/lib/cloud/CloudStore';
import type { CloudCommand, CloudResponse } from '../src/app/interfaces/Cloud';
import { dropboxFixture } from './fixtures/dropboxServer';

let fixture: Awaited<ReturnType<typeof dropboxFixture>>;
let adapter: Dropbox;
let service: CloudService;
let data: ReturnType<CloudPersistence['load']>;
let persistence: CloudPersistence;
let directory: string;
let browser: URL | undefined;
const registration = { clientId: 'fixture-dropbox', clientValue: '' };
const construct = () =>
  new CloudService(
    persistence,
    async (url) => {
      browser = new URL(url);
    },
    () => {},
    undefined,
    null,
    new CloudRecoveryStore(join(directory, 'recovery.bin')),
    { dropbox: adapter, dropboxRegistration: registration },
  );
const request = (command: CloudCommand) =>
  service.handle({ requestId: 'organization-test', command });
const success = (response: CloudResponse) => {
  if (!response.ok) throw Error(response.error);
  return response;
};
beforeEach(async () => {
  fixture = await dropboxFixture();
  adapter = new Dropbox(fixture.endpoints, 0);
  directory = mkdtempSync(join(tmpdir(), 'mkeditor-dropbox-organization-'));
  data = [];
  persistence = {
    load: () => data,
    save: (value) => {
      data = value;
    },
    available: async () => true,
    encrypt: async (tokens) => JSON.stringify(tokens),
    decrypt: async (value) => JSON.parse(value),
  };
  service = construct();
});
afterEach(async () => {
  service.dispose();
  await fixture.close();
  rmSync(directory, { recursive: true, force: true });
});
async function connection(editing = true) {
  const id = success(
    await request({ action: 'add', provider: 'dropbox', name: 'Dropbox' }),
  ).connectionId!;
  browser = undefined;
  const connecting = request({
    action: 'connect',
    connectionId: id,
    writeAccess: editing,
  });
  for (let i = 0; !browser && i < 100; i++)
    await new Promise((resolve) => setTimeout(resolve, 2));
  if (!browser) throw Error('No browser request');
  const callback = new URL(browser.searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({
    code: 'fixture-code',
    state: browser.searchParams.get('state')!,
  }).toString();
  await fetch(callback);
  success(await connecting);
  return { connectionId: id, accountId: fixture.state.account };
}
const restart = () => {
  service.dispose();
  service = construct();
};

test('creates folders through the shared service, deduplicates requests and moves a document by ID', async () => {
  const identity = await connection();
  const command = {
    action: 'createFolder' as const,
    ...identity,
    operationId: 'folder-1',
    folderId: 'root',
    name: 'Drafts',
  };
  const created = success(await request(command));
  expect(created.item).toMatchObject({
    id: expect.stringMatching(/^id:/),
    name: 'Drafts',
    kind: 'folder',
    parents: ['root'],
  });
  expect(success(await request(command)).item).toEqual(created.item);
  expect(fixture.state.folderCreates).toBe(1);
  expect(await request({ ...command, operationId: 'duplicate' })).toMatchObject(
    { ok: false, error: 'duplicate' },
  );
  const move = {
    action: 'move' as const,
    ...identity,
    operationId: 'move-1',
    itemId: 'id:markdown',
    sourceFolderId: 'root',
    folderId: created.item!.id,
  };
  const moved = success(await request(move));
  expect(moved).toMatchObject({
    item: { id: 'id:markdown', parents: [created.item!.id] },
    previousValidator: '"000000001"',
  });
  expect(success(await request(move)).item).toEqual(moved.item);
  expect(fixture.state.moves).toBe(1);
  expect(fixture.files.get('id:markdown')!.content).toBe('# Dropbox notes');
  expect(fixture.state.writes).toBe(0);
  const marker = fixture.state.requests.find(
    (entry) => entry.route === 'file_properties/properties/add',
  );
  expect(marker?.root).toBe('{".tag":"home"}');
});

test('a lost move response survives restart, blocks saves and checks location without replaying the move', async () => {
  const identity = await connection();
  fixture.state.loseMoveReply = true;
  const move = {
    action: 'move' as const,
    ...identity,
    operationId: 'lost-move',
    itemId: 'id:markdown',
    sourceFolderId: 'root',
    folderId: 'id:docs',
  };
  expect(await request(move)).toMatchObject({
    ok: false,
    error: 'unconfirmed',
  });
  restart();
  expect(
    success(await request({ action: 'state' })).state.pendingOperations,
  ).toContainEqual(
    expect.objectContaining({
      provider: 'dropbox',
      kind: 'move',
      itemId: 'id:markdown',
    }),
  );
  expect(
    await request({
      action: 'save',
      ...identity,
      itemId: 'id:markdown',
      validator: '"000000001"',
      content: 'draft',
      operationId: 'blocked-save',
    }),
  ).toMatchObject({ ok: false, error: 'pending_operation' });
  const checked = success(
    await request({
      action: 'reconcileItem',
      ...identity,
      operationId: 'lost-move',
    }),
  );
  expect(checked.item?.parents).toEqual(['id:docs']);
  expect(fixture.state.moves).toBe(1);
  expect(fixture.files.get('id:markdown')!.content).toBe('# Dropbox notes');
});

test('a folder whose creation reply was lost is never adopted without an ownership marker or recreated automatically', async () => {
  const identity = await connection();
  fixture.state.loseFolderReply = true;
  const command = {
    action: 'createFolder' as const,
    ...identity,
    operationId: 'unknown-folder',
    folderId: 'root',
    name: 'Unconfirmed',
  };
  expect(await request(command)).toMatchObject({
    ok: false,
    error: 'unconfirmed',
  });
  restart();
  expect(
    await request({
      action: 'reconcileItem',
      ...identity,
      operationId: command.operationId,
    }),
  ).toMatchObject({ ok: false, error: 'unconfirmed' });
  expect(await request(command)).toMatchObject({
    ok: false,
    error: 'unconfirmed',
  });
  expect(fixture.state.folderCreates).toBe(1);
  expect(fixture.resolve('/Unconfirmed')?.groups).toBeUndefined();
});

test('an acknowledged folder marker recovers after a lost property response and service restart', async () => {
  const identity = await connection();
  fixture.state.losePropertyReply = true;
  expect(
    await request({
      action: 'createFolder',
      ...identity,
      operationId: 'marked-folder',
      folderId: 'root',
      name: 'Recovered',
    }),
  ).toMatchObject({ ok: false, error: 'unconfirmed' });
  restart();
  const result = success(
    await request({
      action: 'reconcileItem',
      ...identity,
      operationId: 'marked-folder',
    }),
  );
  expect(result.item).toMatchObject({
    kind: 'folder',
    id: fixture.resolve('/Recovered')!.id,
    parents: ['root'],
  });
  expect(fixture.state.folderCreates).toBe(1);
});

test('read-only connections cannot create folders or move documents', async () => {
  const identity = await connection(false);
  expect(
    await request({
      action: 'createFolder',
      ...identity,
      operationId: 'folder',
      folderId: 'root',
      name: 'Drafts',
    }),
  ).toMatchObject({ ok: false, error: 'permission' });
  expect(
    await request({
      action: 'move',
      ...identity,
      operationId: 'move',
      itemId: 'id:markdown',
      sourceFolderId: 'root',
      folderId: 'id:docs',
    }),
  ).toMatchObject({ ok: false, error: 'permission' });
  expect(fixture.state.folderCreates + fixture.state.moves).toBe(0);
});

test('folder creation resolves the selected parent ID again after it is renamed', async () => {
  const organization = adapter.organization;
  const plan = await organization.prepareCreate(
    'access',
    'id:docs',
    'Résumé 日本語',
    'unicode-folder',
  );
  fixture.files.get('id:docs')!.path = '/Renamed';
  const folder = await organization.createFolder(
    'access',
    plan,
    'id:docs',
    'Résumé 日本語',
    'unicode-folder',
    () => {},
  );
  if (!folder) throw Error('Folder creation did not return its identity');
  expect(folder).toMatchObject({
    id: fixture.resolve('/Renamed/Résumé 日本語')!.id,
    parents: ['id:docs'],
  });
  expect(
    await organization.createdBy('access', folder.id, 'unicode-folder'),
  ).toBe(true);
});

test('moves preserve a remote edit made during the move and reject a stale subsequent save', async () => {
  const organization = adapter.organization;
  const prepared = await organization.prepareMove(
    'access',
    'id:markdown',
    'root',
    'id:docs',
  );
  fixture.state.beforeWrite = () =>
    fixture.externalEdit('id:markdown', 'concurrent remote text');
  await organization.move(
    'access',
    'id:markdown',
    prepared.source,
    prepared.destination,
    prepared.validator,
    () => {},
  );
  expect(
    (await organization.inspectItem('access', 'id:markdown')).validator,
  ).toBe('"000000002"');
  expect(fixture.files.get('id:markdown')!.content).toBe(
    'concurrent remote text',
  );
  await expect(
    adapter.update(
      'access',
      'id:markdown',
      prepared.validator,
      'stale local text',
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(fixture.state.writes).toBe(0);
});

test('a write-time destination collision leaves both files unchanged', async () => {
  const organization = adapter.organization;
  const prepared = await organization.prepareMove(
    'access',
    'id:markdown',
    'root',
    'id:docs',
  );
  fixture.state.beforeWrite = () =>
    fixture.files.set('id:other', {
      id: 'id:other',
      path: '/Documents/notes.md',
      name: 'notes.md',
      content: 'other document',
      revision: 1,
    });
  await expect(
    organization.move(
      'access',
      'id:markdown',
      prepared.source,
      prepared.destination,
      prepared.validator,
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'duplicate' });
  expect(fixture.files.get('id:markdown')!.path).toBe('/notes.md');
  expect(fixture.files.get('id:other')!.content).toBe('other document');
  expect(fixture.state.moves).toBe(0);
});

test('a changed source or a denied destination is rejected before any move', async () => {
  const organization = adapter.organization;
  const prepared = await organization.prepareMove(
    'access',
    'id:markdown',
    'root',
    'id:docs',
  );
  fixture.externalEdit('id:markdown', 'new revision');
  await expect(
    organization.move(
      'access',
      'id:markdown',
      prepared.source,
      prepared.destination,
      prepared.validator,
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  fixture.files.get('id:docs')!.readOnly = true;
  await expect(
    organization.prepareMove('access', 'id:markdown', 'root', 'id:docs'),
  ).rejects.toMatchObject({ code: 'permission' });
  await expect(
    organization.prepareCreate('access', 'id:docs', 'Drafts', 'folder'),
  ).rejects.toMatchObject({ code: 'permission' });
  expect(fixture.state.moves + fixture.state.folderCreates).toBe(0);
});

test('checking an unmarked existing folder never creates a recovery template or claims ownership', async () => {
  expect(
    await adapter.organization.createdBy('access', 'id:docs', 'not-ours'),
  ).toBe(false);
  expect(
    fixture.state.requests.some(
      (entry) => entry.route === 'file_properties/templates/add_for_user',
    ),
  ).toBe(false);
  expect(fixture.files.get('id:docs')!.groups).toBeUndefined();
});
