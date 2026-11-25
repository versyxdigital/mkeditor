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

test('creates folders and deduplicates requests while declining unsafe document moves', async () => {
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
  expect(await request(move)).toMatchObject({
    ok: false,
    error: 'unsupported',
  });
  expect(await request(move)).toMatchObject({
    ok: false,
    error: 'unsupported',
  });
  expect(fixture.state.moves).toBe(0);
  expect(
    success(await request({ action: 'state' })).state.pendingOperations ?? [],
  ).toEqual([]);
  expect(fixture.files.get('id:markdown')!.content).toBe('# Dropbox notes');
  expect(fixture.state.writes).toBe(0);
  const marker = fixture.state.requests.find(
    (entry) => entry.route === 'file_properties/properties/add',
  );
  expect(marker?.root).toBe('{".tag":"home"}');
});

test('an older pending move remains recoverable after restart without replaying a move', async () => {
  const identity = await connection();
  const move = {
    action: 'move' as const,
    ...identity,
    operationId: 'lost-move',
    itemId: 'id:markdown',
    sourceFolderId: 'root',
    folderId: 'id:docs',
  };
  // Seed an older release's journal; current releases must never perform this move.
  await new CloudRecoveryStore(join(directory, 'recovery.bin')).saveOperations([
    {
      provider: 'dropbox',
      kind: 'move',
      ...identity,
      operationId: move.operationId,
      itemId: move.itemId,
      sourceFolderId: move.sourceFolderId,
      folderId: move.folderId,
      fingerprint: JSON.stringify(move),
      previousValidator: '"000000001"',
    },
  ]);
  fixture.files.get('id:markdown')!.path = '/Documents/notes.md';
  restart();
  expect(
    success(await request({ action: 'state' })).state.pendingOperations ?? [],
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
      operationId: move.operationId,
    }),
  );
  expect(checked.item?.parents).toEqual(['id:docs']);
  expect(fixture.state.moves).toBe(0);
  expect(fixture.state.writes).toBe(0);
  expect(fixture.files.get('id:markdown')!.content).toBe('# Dropbox notes');
});

test.each(['replacement', 'relocation', 'revision'] as const)(
  'declines a move after a concurrent source %s without sending any mutation',
  async (change) => {
    const organization = adapter.organization;
    const opened = await adapter.read('access', 'id:markdown', true);
    if (change === 'revision')
      fixture.externalEdit('id:markdown', 'external edit');
    else fixture.files.get('id:markdown')!.path = '/Elsewhere/notes.md';
    if (change === 'replacement')
      fixture.files.set('id:replacement', {
        id: 'id:replacement',
        name: 'notes.md',
        path: '/notes.md',
        content: 'different document',
        revision: 1,
      });
    const before = [...fixture.files].map(([id, file]) => [id, { ...file }]);
    const requests = fixture.state.requests.length;
    const authorize = jest.fn();
    await expect(
      organization.move(
        'access',
        'id:markdown',
        'root',
        'id:docs',
        opened.item.validator!,
        authorize,
      ),
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(authorize).not.toHaveBeenCalled();
    expect(fixture.state.requests).toHaveLength(requests);
    expect(fixture.state.moves + fixture.state.writes).toBe(0);
    expect([...fixture.files].map(([id, file]) => [id, { ...file }])).toEqual(
      before,
    );
    if (change === 'replacement') {
      expect(fixture.files.get('id:replacement')!.path).toBe('/notes.md');
      expect(fixture.files.get('id:replacement')!.content).toBe(
        'different document',
      );
    }
  },
);

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

test('a replacement scheduled after source validation cannot be moved by a request', async () => {
  const identity = await connection();
  const replace = jest.fn(() => {
    fixture.files.get('id:markdown')!.path = '/Elsewhere/notes.md';
    fixture.files.set('id:replacement', {
      id: 'id:replacement',
      name: 'notes.md',
      path: '/notes.md',
      content: 'replacement document',
      revision: 1,
    });
  });
  // The fixture executes this immediately before move_v2 resolves from_path.
  // Checking the returned ID would already be too late to protect the replacement.
  fixture.state.beforeWrite = replace;
  expect(
    await request({
      action: 'move',
      ...identity,
      operationId: 'write-time-replacement',
      itemId: 'id:markdown',
      sourceFolderId: 'root',
      folderId: 'id:docs',
    }),
  ).toMatchObject({ ok: false, error: 'unsupported' });
  expect(replace).not.toHaveBeenCalled();
  expect(
    fixture.state.requests.some((entry) => entry.route === 'files/move_v2'),
  ).toBe(false);
  expect(fixture.state.moves + fixture.state.writes).toBe(0);
  expect(fixture.files.get('id:markdown')!.path).toBe('/notes.md');
  expect(fixture.files.get('id:markdown')!.content).toBe('# Dropbox notes');
});

test('move preparation is unsupported and read-only destinations still reject folder creation', async () => {
  const requests = fixture.state.requests.length;
  await expect(
    adapter.organization.prepareMove(
      'access',
      'id:markdown',
      'root',
      'id:docs',
    ),
  ).rejects.toMatchObject({ code: 'unsupported' });
  expect(fixture.state.requests).toHaveLength(requests);
  fixture.files.get('id:docs')!.readOnly = true;
  await expect(
    adapter.organization.prepareCreate('access', 'id:docs', 'Drafts', 'folder'),
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
