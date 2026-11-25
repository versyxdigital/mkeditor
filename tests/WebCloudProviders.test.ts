/** @jest-environment node */
import type { CloudCommand } from '../src/app/interfaces/Cloud';
import { WebCloudService } from '../src/browser/core/cloud/WebCloudService';
import {
  WebGoogleDrive,
  WebDropbox,
} from '../src/browser/core/cloud/WebCloudProviders';
import { driveFixture } from './fixtures/driveServer';
import { dropboxFixture } from './fixtures/dropboxServer';
import {
  browserAuth,
  browserOwnership,
  MemoryCloudStorage,
} from './utils/webCloud';

let drive: Awaited<ReturnType<typeof driveFixture>>;
let dropbox: Awaited<ReturnType<typeof dropboxFixture>>;
let cloud: WebCloudService;
let storage: MemoryCloudStorage;
let auth: ReturnType<typeof browserAuth>;
const realFetch = globalThis.fetch;
const request = (command: CloudCommand) =>
  cloud.handle({ requestId: crypto.randomUUID(), command });

beforeEach(async () => {
  drive = await driveFixture();
  dropbox = await dropboxFixture();
  globalThis.fetch = jest.fn((input, init) => {
    const url = new URL(String(input));
    const endpoint =
      url.hostname === 'www.googleapis.com'
        ? drive.endpoints.api
        : dropbox.endpoints.api;
    return realFetch(new URL(url.pathname + url.search, endpoint), init);
  });
  auth = browserAuth();
  storage = new MemoryCloudStorage();
  cloud = new WebCloudService(() => {}, {
    storage,
    auth: auth.auth,
    ownership: browserOwnership(),
  });
  await cloud.state();
});

afterEach(async () => {
  cloud.dispose();
  globalThis.fetch = realFetch;
  await Promise.all([drive.close(), dropbox.close()]);
});

async function connection(
  provider: 'google-drive' | 'dropbox',
  editing = true,
) {
  const result = await request({
    action: 'add',
    provider,
    name: provider,
    authorize: true,
  });
  if (!result.ok) throw new Error(result.error);
  const id = result.connectionId!;
  if (editing)
    expect(
      await request({ action: 'connect', connectionId: id, writeAccess: true }),
    ).toMatchObject({ ok: true });
  return id;
}

test('browser Drive keeps its exact v2 If-Match path and rejects stale saves', async () => {
  const id = await connection('google-drive');
  const opened = await request({
    action: 'open',
    connectionId: id,
    itemId: 'markdown',
    accountId: 'account-a',
  });
  if (!opened.ok) throw new Error(opened.error);
  expect(opened.document?.item.editable).toBe(true);
  const validator = opened.document!.item.validator!;
  drive.state.revision = '2';
  drive.state.content = 'external newer content';
  expect(
    await request({
      action: 'save',
      connectionId: id,
      accountId: 'account-a',
      itemId: 'markdown',
      validator,
      content: 'attempted browser overwrite',
      operationId: 'stale',
    }),
  ).toMatchObject({ ok: false, error: 'conflict' });
  expect(drive.state.content).toBe('external newer content');
  expect(drive.calls.find((call) => call.method === 'PUT')?.ifMatch).toBe(
    validator,
  );
});

test('browser Dropbox saves by revision and records unknown writes before mutation', async () => {
  const id = await connection('dropbox');
  const opened = await request({
    action: 'open',
    connectionId: id,
    itemId: 'id:markdown',
    accountId: 'dbid:fixture',
  });
  if (!opened.ok) throw new Error(opened.error);
  dropbox.state.loseWriteReply = true;
  const result = await request({
    action: 'save',
    connectionId: id,
    accountId: 'dbid:fixture',
    itemId: 'id:markdown',
    validator: opened.document!.item.validator!,
    content: 'Unicode caf\u00e9 \u4e2d\u6587 \u{1f600}',
    operationId: 'unknown',
  });
  expect(result).toMatchObject({ ok: false, error: 'unconfirmed' });
  expect(dropbox.files.get('id:markdown')?.content).toBe(
    'Unicode caf\u00e9 \u4e2d\u6587 \u{1f600}',
  );
  expect(dropbox.state.lastUpload).toMatchObject({
    mode: { '.tag': 'update' },
    autorename: false,
    strict_conflict: true,
  });
  cloud.dispose();
  cloud = new WebCloudService(() => {}, {
    storage,
    auth: auth.auth,
    ownership: browserOwnership(),
  });
  const restored = await cloud.restoreSession(null);
  expect(restored?.tabs[0].remote).toMatchObject({
    dirty: true,
    pendingSave: { operationId: 'unknown' },
    document: {
      content: 'Unicode caf\u00e9 \u4e2d\u6587 \u{1f600}',
      accountId: 'dbid:fixture',
    },
  });
  expect((await cloud.state()).connections[0].status).toBe('reauthorize');
  expect(
    await request({ action: 'connect', connectionId: id, writeAccess: true }),
  ).toMatchObject({ ok: true });
  expect(
    await request({
      action: 'reconcile',
      connectionId: id,
      accountId: 'dbid:fixture',
      operationId: 'unknown',
    }),
  ).toMatchObject({ ok: true, document: { operationId: 'unknown' } });
  expect(dropbox.state.writes).toBe(1);
});

test('browser creation remains create-only and serializes Unicode arguments safely', async () => {
  const id = await connection('dropbox');
  const created = await request({
    action: 'create',
    connectionId: id,
    accountId: 'dbid:fixture',
    folderId: 'root',
    name: '\u65b0\u3057\u3044 caf\u00e9.md',
    content: '# \u65b0\u3057\u3044 \u{1f600}',
    operationId: 'create-1',
  });
  expect(created).toMatchObject({
    ok: true,
    document: { content: '# \u65b0\u3057\u3044 \u{1f600}' },
  });
  expect(dropbox.state.lastUpload).toMatchObject({
    mode: { '.tag': 'add' },
    autorename: false,
    strict_conflict: true,
  });
  expect(
    await request({
      action: 'create',
      connectionId: id,
      accountId: 'dbid:fixture',
      folderId: 'root',
      name: '\u65b0\u3057\u3044 caf\u00e9.md',
      content: 'overwrite',
      operationId: 'create-2',
    }),
  ).toMatchObject({ ok: false, error: 'duplicate' });
  expect(dropbox.state.creates).toBe(1);
});

test('write upgrade requires all scopes and expiry asks for a new browser sign-in', async () => {
  const id = await connection('google-drive', false);
  auth.values.grantWrite = false;
  expect(
    await request({ action: 'connect', connectionId: id, writeAccess: true }),
  ).toMatchObject({ ok: false, error: 'permission' });
  expect((await cloud.state()).connections[0].writeAccess).toBe(false);
  auth.values.grantWrite = true;
  auth.values.expires = Date.now() + 10_000;
  expect(await request({ action: 'connect', connectionId: id })).toMatchObject({
    ok: true,
  });
  expect(
    await request({ action: 'list', connectionId: id, folderId: 'root' }),
  ).toMatchObject({ ok: false, error: 'auth' });
  expect((await cloud.state()).connections[0].status).toBe('reauthorize');
  expect(drive.state.refreshes).toBe(0);
});

test('reconnecting another account never lets an old draft write to that account', async () => {
  const id = await connection('google-drive');
  drive.state.accountId = 'account-b';
  expect(
    await request({ action: 'connect', connectionId: id, writeAccess: true }),
  ).toMatchObject({ ok: true });
  expect(
    await request({
      action: 'save',
      connectionId: id,
      accountId: 'account-a',
      itemId: 'markdown',
      validator: '"1"',
      content: 'old account document',
      operationId: 'wrong-account',
    }),
  ).toMatchObject({ ok: false, error: 'auth' });
  expect(drive.calls.some((call) => call.method === 'PUT')).toBe(false);
});

test('missing Dropbox CORS metadata fails read rather than guessing a revision', async () => {
  const adapter = new WebDropbox(auth.auth);
  const redirectedFetch = globalThis.fetch;
  globalThis.fetch = jest.fn(async (input, init) => {
    const response = await redirectedFetch(input, init);
    if (String(input).endsWith('/files/download'))
      return new Response(await response.arrayBuffer(), {
        status: response.status,
      });
    return response;
  });
  await expect(
    adapter.read('access', 'id:markdown', true),
  ).rejects.toMatchObject({ code: 'network' });
});

test('browser adapters reject desktop secrets and never attempt refresh-token exchange', async () => {
  const adapter = new WebGoogleDrive(auth.auth);
  await expect(
    adapter.beginAuthorization(
      {
        clientId: 'fixture.apps.googleusercontent.com',
        clientValue: 'desktop-value',
      },
      async () => {},
    ),
  ).rejects.toMatchObject({ code: 'configuration' });
  await expect(adapter.refresh()).rejects.toMatchObject({ code: 'auth' });
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test('storage failure prevents a conditional write from leaving the browser', async () => {
  const id = await connection('google-drive');
  storage.failWrites = true;
  expect(
    await request({
      action: 'save',
      connectionId: id,
      accountId: 'account-a',
      itemId: 'markdown',
      validator: '"1"',
      content: 'cannot journal',
      operationId: 'undurable',
    }),
  ).toMatchObject({ ok: false, error: 'storage' });
  expect(drive.calls.some((call) => call.method === 'PUT')).toBe(false);
  expect(drive.state.content).toBe('# Remote Markdown');
});

test.each([
  null,
  undefined,
  [],
  'invalid',
  {},
  { requestId: 'bad', command: { action: 'connect' } },
])(
  'malformed requests fail through the typed cloud response boundary: %p',
  async (input) => {
    await expect(cloud.handle(input)).resolves.toMatchObject({
      ok: false,
      error: 'configuration',
    });
    expect(auth.auth.reserveAuthorization).not.toHaveBeenCalled();
  },
);

test('corrupt connection metadata does not escape the typed response boundary or open a popup', async () => {
  storage.setItem('mkeditor-cloud-connections', '{invalid');
  await expect(
    request({ action: 'connect', connectionId: 'broken' }),
  ).resolves.toMatchObject({ ok: false, error: 'storage' });
  expect(auth.auth.reserveAuthorization).not.toHaveBeenCalled();
});
