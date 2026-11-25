/** @jest-environment node */
import {
  Dropbox,
  DROPBOX_READ_SCOPES,
  DROPBOX_WRITE_SCOPES,
} from '../src/app/lib/cloud/Dropbox';
import { dropboxFixture } from './fixtures/dropboxServer';

let fixture: Awaited<ReturnType<typeof dropboxFixture>>;
let adapter: Dropbox;
const registration = { clientId: 'fixture-dropbox-key', clientValue: '' };
beforeEach(async () => {
  fixture = await dropboxFixture();
  adapter = new Dropbox(fixture.endpoints, 0);
});
afterEach(async () => {
  await fixture.close();
});

test('desktop OAuth uses PKCE, validates state and refreshes without an app secret', async () => {
  let authorize!: URL;
  const flow = await adapter.beginAuthorization(registration, async (value) => {
    authorize = new URL(value);
  });
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorize.searchParams.get('token_access_type')).toBe('offline');
  const redirect = new URL(authorize.searchParams.get('redirect_uri')!);
  expect(redirect.hostname).toBe('127.0.0.1');
  const wrong = new URL(redirect);
  wrong.search = 'state=wrong&code=fixture-code';
  expect((await fetch(wrong)).status).toBe(400);
  redirect.search = new URLSearchParams({
    state: authorize.searchParams.get('state')!,
    code: 'fixture-code',
  }).toString();
  const callback = await fetch(redirect);
  expect(callback.headers.get('Cache-Control')).toBe('no-store');
  expect(await callback.text()).toContain('Return to MKEditor');
  const tokens = await flow.result;
  expect(fixture.state.lastToken?.has('client_secret')).toBe(false);
  expect(fixture.state.lastToken?.get('code_verifier')).toHaveLength(64);
  const refreshed = await adapter.refresh(
    registration,
    tokens.refresh,
    tokens.scopes,
  );
  expect(refreshed.refresh).toBe(tokens.refresh);
  expect(fixture.state.refreshes).toBe(1);
});

test('cancellation and unsupported scopes cannot authorize an app', async () => {
  const flow = await adapter.beginAuthorization(registration, async () => {});
  flow.cancel();
  await expect(flow.result).rejects.toMatchObject({ code: 'cancelled' });
  expect(adapter.authorizationScopes(false)).toEqual(DROPBOX_READ_SCOPES);
  expect(adapter.authorizationScopes(true)).toEqual([
    ...DROPBOX_READ_SCOPES,
    ...DROPBOX_WRITE_SCOPES,
  ]);
  await expect(
    adapter.beginAuthorization(registration, async () => {}, 1000, undefined, [
      'team_data.member',
    ]),
  ).rejects.toMatchObject({ code: 'configuration' });
  await expect(
    adapter.beginAuthorization(
      { ...registration, clientValue: 'unneeded' },
      async () => {},
    ),
  ).rejects.toMatchObject({ code: 'configuration' });
});

test('browsing classifies content and stays inside the account home namespace', async () => {
  const page = await adapter.list('access', 'root');
  expect(page.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'id:docs', kind: 'folder' }),
      expect.objectContaining({ id: 'id:markdown', kind: 'markdown' }),
      expect.objectContaining({ id: 'id:image', kind: 'unsupported' }),
    ]),
  );
  expect(
    fixture.state.requests.find(
      (request) => request.route === 'files/list_folder',
    )?.root,
  ).toBe('{".tag":"home"}');
  const read = await adapter.read('access', 'id:markdown', true);
  expect(read).toMatchObject({
    content: '# Dropbox notes',
    item: { id: 'id:markdown', validator: '"000000001"', editable: true },
  });
  fixture.files.get('id:markdown')!.readOnly = true;
  expect(
    (await adapter.read('access', 'id:markdown', true)).item.editable,
  ).toBe(false);
});

test('the write itself rejects a stale revision and preserves external edits', async () => {
  const opened = await adapter.read('access', 'id:markdown', true);
  fixture.state.beforeWrite = () =>
    fixture.externalEdit('id:markdown', 'external edits');
  await expect(
    adapter.update(
      'access',
      opened.item.id,
      opened.item.validator!,
      'my draft',
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(fixture.files.get('id:markdown')!.content).toBe('external edits');
  expect(fixture.state.writes).toBe(0);
  expect(fixture.state.lastUpload).toMatchObject({
    path: 'id:markdown',
    mode: { '.tag': 'update', update: '000000001' },
    strict_conflict: true,
    autorename: false,
  });
});

test('saving follows the stable ID after a move and leaves a replacement at the old path untouched', async () => {
  const opened = await adapter.read('access', 'id:markdown', true);
  fixture.files.get('id:markdown')!.path = '/Documents/notes.md';
  fixture.files.set('id:replacement', {
    id: 'id:replacement',
    name: 'notes.md',
    path: '/notes.md',
    content: 'replacement',
    revision: 1,
  });
  const saved = await adapter.update(
    'access',
    opened.item.id,
    opened.item.validator!,
    'saved text',
    () => {},
  );
  expect(saved.item).toMatchObject({
    id: 'id:markdown',
    parents: ['id:docs'],
    validator: '"000000002"',
  });
  expect(fixture.files.get('id:replacement')!.content).toBe('replacement');
});

test('deleted files cannot be recreated by Save and path-based update targets are rejected', async () => {
  fixture.files.delete('id:markdown');
  await expect(
    adapter.update('access', 'id:markdown', '"000000001"', 'draft', () => {}),
  ).rejects.toMatchObject({ code: 'missing' });
  for (const path of ['/notes.md', 'id:docs/notes.md'])
    await expect(
      adapter.update('access', path, '"000000001"', 'draft', () => {}),
    ).rejects.toMatchObject({ code: 'configuration' });
  expect(fixture.state.writes).toBe(0);
});

test('creation binds to the destination ID and refuses preflight and write-time collisions', async () => {
  const plan = await adapter.prepareCreate(
    'access',
    'id:docs',
    'Résumé 日本語.md',
    'created-once',
  );
  fixture.files.get('id:docs')!.path = '/Renamed';
  const created = await adapter.create(
    'access',
    plan,
    'id:docs',
    'Résumé 日本語.md',
    'new writing',
    'created-once',
    () => {},
  );
  expect(fixture.resolve('/Renamed/Résumé 日本語.md')?.id).toBe(
    created.item.id,
  );
  expect(await adapter.createdBy('access', plan, 'created-once')).toBe(true);
  await expect(
    adapter.prepareCreate('access', 'id:docs', 'Résumé 日本語.md', 'duplicate'),
  ).rejects.toMatchObject({ code: 'duplicate' });
  const collision = await adapter.prepareCreate(
    'access',
    'root',
    'new.md',
    'create',
  );
  fixture.state.beforeWrite = () =>
    fixture.files.set('id:other', {
      id: 'id:other',
      name: 'new.md',
      path: '/new.md',
      content: 'same',
      revision: 1,
    });
  await expect(
    adapter.create(
      'access',
      collision,
      'root',
      'new.md',
      'same',
      'create',
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'duplicate' });
  expect(fixture.state.creates).toBe(1);
});

test('a lost creation response is reconciled by the app-owned marker without replay', async () => {
  const plan = await adapter.prepareCreate(
    'access',
    'root',
    'created.md',
    'lost-create',
  );
  fixture.state.loseWriteReply = true;
  await expect(
    adapter.create(
      'access',
      plan,
      'root',
      'created.md',
      'retained',
      'lost-create',
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'unconfirmed' });
  expect(await adapter.createdBy('access', plan, 'lost-create')).toBe(true);
  expect((await adapter.read('access', plan, true)).content).toBe('retained');
  expect(fixture.state.creates).toBe(1);
  fixture.resolve('/created.md')!.groups = [];
  await expect(adapter.read('access', plan, true)).rejects.toMatchObject({
    code: 'unconfirmed',
  });
});

test('lost save responses remain unconfirmed and writes are never retried', async () => {
  fixture.state.loseWriteReply = true;
  await expect(
    adapter.update(
      'access',
      'id:markdown',
      '"000000001"',
      'written once',
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'unconfirmed' });
  expect(fixture.state.writes).toBe(1);
  expect((await adapter.read('access', 'id:markdown', true)).content).toBe(
    'written once',
  );
});

test('cancellation, invalid encoding and the UTF-8 byte limit protect the provider file', async () => {
  await expect(
    adapter.update('access', 'id:markdown', '"000000001"', 'never sent', () => {
      throw new Error('cancelled');
    }),
  ).rejects.toThrow('cancelled');
  fixture.state.rawDownload = Buffer.from([0xff, 0xfe]);
  await expect(adapter.read('access', 'id:markdown')).rejects.toMatchObject({
    code: 'unsupported',
  });
  fixture.state.rawDownload = undefined;
  await expect(
    adapter.update(
      'access',
      'id:markdown',
      '"000000001"',
      'é'.repeat(3 * 1024 * 1024),
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'unsupported' });
  expect(fixture.state.writes).toBe(0);
});

test.each([
  [401, 'invalid_access_token', 'auth'],
  [403, 'no_write_permission', 'permission'],
  [409, 'path/not_found', 'missing'],
  [409, 'path/insufficient_space', 'quota'],
  [429, 'too_many_requests', 'throttled'],
] as const)(
  'provider error %s/%s maps to %s',
  async (status, summary, code) => {
    fixture.state.error = {
      route: 'files/get_metadata',
      status,
      summary,
      count: 3,
    };
    await expect(adapter.read('access', 'id:markdown')).rejects.toMatchObject({
      code,
    });
  },
);
