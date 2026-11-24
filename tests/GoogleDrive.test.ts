/** @jest-environment node */
import { createHash } from 'crypto';
import {
  GoogleDrive,
  DRIVE_SCOPE,
  DRIVE_FILE_SCOPE,
} from '../src/app/lib/cloud/GoogleDrive';
import { driveFixture } from './fixtures/driveServer';

let fixture: Awaited<ReturnType<typeof driveFixture>>;
let drive: GoogleDrive;
const registration = {
  clientId: 'fixture.apps.googleusercontent.com',
  clientValue: 'public-desktop-value',
};
beforeEach(async () => {
  fixture = await driveFixture();
  drive = new GoogleDrive(fixture.endpoints);
});
afterEach(async () => {
  await fixture.close();
});

test('browser OAuth uses PKCE and loopback; invalid state cannot redeem, callback is consumed once', async () => {
  let authorize!: URL;
  const flow = await drive.beginAuthorization(registration, async (url) => {
    authorize = new URL(url);
  });
  expect(authorize.searchParams.get('scope')).toBe(DRIVE_SCOPE);
  const callback = new URL(authorize.searchParams.get('redirect_uri')!);
  expect(callback.hostname).toBe('127.0.0.1');
  callback.search = new URLSearchParams({
    state: 'mismatched',
    code: 'fixture-code',
  }).toString();
  expect((await fetch(callback)).status).toBe(400);
  expect(fixture.calls).toHaveLength(0);
  callback.searchParams.set('state', authorize.searchParams.get('state')!);
  const response = await fetch(callback);
  const html = await response.text();
  expect(html).toContain('Return to MKEditor');
  expect(html).toContain('history.replaceState');
  expect(html).not.toContain('fixture-code');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const tokens = await flow.result;
  expect(tokens.refresh).toBe('fixture-refresh');
  const verifier = fixture.state.tokenForm!.get('code_verifier')!;
  expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
    authorize.searchParams.get('code_challenge'),
  );
  await expect(fetch(callback)).rejects.toThrow();
});

test('expired and cancelled flows cannot later redeem a callback', async () => {
  let authorize!: URL;
  const flow = await drive.beginAuthorization(
    registration,
    async (url) => {
      authorize = new URL(url);
    },
    15,
  );
  await expect(flow.result).rejects.toMatchObject({ code: 'cancelled' });
  await expect(
    fetch(authorize.searchParams.get('redirect_uri')!),
  ).rejects.toThrow();
  expect(fixture.calls).toHaveLength(0);
});

test('OAuth rejects duplicated callback parameters and denial does not exchange tokens', async () => {
  let authorize!: URL;
  const flow = await drive.beginAuthorization(registration, async (url) => {
    authorize = new URL(url);
  });
  const callback = new URL(authorize.searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({
    state: authorize.searchParams.get('state')!,
    code: 'one',
  }).toString();
  callback.searchParams.append('code', 'two');
  expect((await fetch(callback)).status).toBe(400);
  callback.searchParams.delete('code');
  callback.searchParams.set('error', 'access_denied');
  expect((await fetch(callback)).status).toBe(200);
  await expect(flow.result).rejects.toMatchObject({ code: 'cancelled' });
  expect(fixture.calls).toHaveLength(0);
});

test('lists multiple pages, distinguishes native/unsupported types, and addresses shared drives', async () => {
  const first = await drive.list('fixture-access', 'root');
  expect(first.nextPage).toBe('second');
  expect(first.items.find((item) => item.name === 'Google.md')?.kind).toBe(
    'unsupported',
  );
  expect(first.items.find((item) => item.name === 'document.pdf')?.kind).toBe(
    'unsupported',
  );
  expect(first.items.find((item) => item.name === 'Shortcut.md')?.id).toBe(
    'markdown',
  );
  expect(
    (await drive.list('fixture-access', 'root', undefined, first.nextPage))
      .items[0].id,
  ).toBe('second');
  await drive.list('fixture-access', 'team-folder', 'team');
  const params = fixture.calls.at(-1)!.url.searchParams;
  expect(params.get('supportsAllDrives')).toBe('true');
  expect(params.get('includeItemsFromAllDrives')).toBe('true');
  expect(params.get('corpora')).toBe('drive');
  expect(params.get('driveId')).toBe('team');
  expect(params.get('fields')).toContain('nextPageToken');
  expect((await drive.drives('fixture-access')).items[0].driveId).toBe('team');
});

test('read resolves shortcuts by identity and never writes; missing/native/trashed items fail safely', async () => {
  const document = await drive.read('fixture-access', 'shortcut');
  expect(document).toMatchObject({
    item: { id: 'markdown', revision: '1' },
    content: '# Remote Markdown',
  });
  await expect(drive.read('fixture-access', 'gone')).rejects.toMatchObject({
    code: 'missing',
  });
  await expect(drive.read('fixture-access', 'native')).rejects.toMatchObject({
    code: 'unsupported',
  });
  fixture.state.trashed = true;
  await expect(drive.read('fixture-access', 'markdown')).rejects.toMatchObject({
    code: 'missing',
  });
  expect(fixture.calls.every((call) => call.method === 'GET')).toBe(true);
});

test('a revision change during download never labels mixed content with the wrong revision', async () => {
  fixture.state.override = (url) => {
    if (url.searchParams.get('alt') === 'media') fixture.state.revision = '2';
    return false;
  };
  await expect(drive.read('fixture-access', 'markdown')).rejects.toMatchObject({
    code: 'conflict',
  });
});

test.each([
  [401, '', 'auth'],
  [403, 'insufficientFilePermissions', 'permission'],
  [403, 'storageQuotaExceeded', 'quota'],
  [429, '', 'throttled'],
  [400, 'invalid_client', 'configuration'],
])('maps %s to a redacted actionable error', async (status, reason, code) => {
  fixture.state.override = (_url, response) => {
    response.writeHead(Number(status), {
      'Retry-After': '30',
      'Content-Type': 'application/json',
    });
    response.end(
      JSON.stringify({
        error: { message: 'sensitive-provider-detail', errors: [{ reason }] },
      }),
    );
    return true;
  };
  await expect(drive.account('fixture-access')).rejects.toMatchObject({ code });
  await expect(drive.account('fixture-access')).rejects.not.toThrow(
    'sensitive-provider-detail',
  );
});

test('safe reads retry bounded throttling and token requests never replay', async () => {
  let requests = 0;
  fixture.state.override = (_url, response) => {
    requests++;
    if (requests > 2) return false;
    response.writeHead(429, { 'Retry-After': '0' });
    response.end('{}');
    return true;
  };
  expect((await drive.account('fixture-access')).id).toBe('account-a');
  expect(requests).toBe(3);
  requests = 0;
  await expect(
    drive.refresh(registration, 'fixture-refresh'),
  ).rejects.toMatchObject({ code: 'throttled' });
  expect(requests).toBe(1);
});

test('localized callback strings are escaped before browser rendering', async () => {
  let authorize!: URL;
  const flow = await drive.beginAuthorization(
    registration,
    async (url) => {
      authorize = new URL(url);
    },
    180_000,
    {
      title: '<script>unsafe()</script>',
      accepted: 'Retour à MKEditor',
      cancelled: 'Annulé',
      close: 'Fermer cet onglet',
      invalid: 'Invalide',
    },
  );
  const callback = new URL(authorize.searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({
    state: authorize.searchParams.get('state')!,
    code: 'fixture-code',
  }).toString();
  const html = await (await fetch(callback)).text();
  expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
  expect(html).not.toContain('<script>unsafe()');
  expect(html).toContain('Retour à MKEditor');
  await flow.result;
});

test('only the opt-in verifier requests create-only scope in addition to read access', async () => {
  let authorize!: URL;
  const flow = await drive.beginAuthorization(
    registration,
    async (url) => {
      authorize = new URL(url);
    },
    180_000,
    undefined,
    [DRIVE_SCOPE, DRIVE_FILE_SCOPE],
  );
  expect(authorize.searchParams.get('scope')!.split(' ')).toEqual([
    DRIVE_SCOPE,
    DRIVE_FILE_SCOPE,
  ]);
  flow.cancel();
  await expect(flow.result).rejects.toMatchObject({ code: 'cancelled' });
});

test('the verifier cannot request arbitrary scopes or skip the normal read scope', async () => {
  const browser = jest.fn();
  await expect(
    drive.beginAuthorization(registration, browser, 180_000, undefined, [
      DRIVE_SCOPE,
      'https://www.googleapis.com/auth/calendar',
    ]),
  ).rejects.toMatchObject({ code: 'configuration' });
  await expect(
    drive.beginAuthorization(registration, browser, 180_000, undefined, [
      DRIVE_FILE_SCOPE,
    ]),
  ).rejects.toMatchObject({ code: 'configuration' });
  expect(browser).not.toHaveBeenCalled();
});

test('metadata move rejects a stale validator without changing location or text', async () => {
  const original = fixture.state.content;
  const prepared = await drive.prepareMove(
    'fixture-access',
    'markdown',
    'root',
    'folder',
  );
  fixture.state.revision = '2';
  await expect(
    drive.move(
      'fixture-access',
      'markdown',
      prepared.source,
      prepared.destination,
      prepared.validator,
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(fixture.state.parents).toEqual(['root']);
  expect(fixture.state.content).toBe(original);
});

test('move preflight refuses duplicate destinations and shared-drive sources', async () => {
  fixture.state.duplicate = true;
  await expect(
    drive.prepareMove('fixture-access', 'markdown', 'root', 'folder'),
  ).rejects.toMatchObject({ code: 'duplicate' });
  fixture.state.duplicate = false;
  fixture.state.shared = true;
  await expect(
    drive.prepareMove('fixture-access', 'markdown', 'root', 'folder'),
  ).rejects.toMatchObject({ code: 'unsupported' });
  expect(fixture.calls.some((call) => call.method === 'PATCH')).toBe(false);
});
