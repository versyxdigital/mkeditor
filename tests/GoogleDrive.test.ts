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

test.each(['documents', 'folders'] as const)(
  'two clients creating same-name %s retain their own IDs and report both creations as name conflicts',
  async (kind) => {
    fixture.state.creations = new Map();
    fixture.state.generatedIds = ['client-a', 'client-b'];
    const clients = [drive, new GoogleDrive(fixture.endpoints)];
    const name = kind === 'documents' ? "Team's notes.md" : "Team's drafts";
    const ids = await Promise.all(
      clients.map((client) =>
        client.prepareCreate('fixture-access', 'root', name),
      ),
    );
    let release!: () => void;
    fixture.state.writeWait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const outcomes = Promise.allSettled(
      clients.map((client, index) =>
        kind === 'folders'
          ? client.createFolder(
              'fixture-access',
              ids[index],
              'root',
              name,
              `client-${index}`,
              () => {},
            )
          : client.create(
              'fixture-access',
              ids[index],
              'root',
              name,
              `client ${index} content`,
              `client-${index}`,
              () => {},
            ),
      ),
    );
    try {
      for (
        let attempt = 0;
        attempt < 200 &&
        fixture.calls.filter((call) => call.method === 'POST').length < 2;
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 2));
      expect(
        fixture.calls.filter((call) => call.method === 'POST'),
      ).toHaveLength(2);
      release();
      const results = await outcomes;
      for (const [index, result] of results.entries()) {
        if (result.status !== 'fulfilled') throw result.reason;
        const created =
          'item' in result.value ? result.value.item : result.value;
        expect(created).toMatchObject({
          id: ids[index],
          name,
          nameConflict: true,
        });
        expect(
          fixture.state.creations.get(ids[index])?.appProperties
            .mkeditorCreateOperation,
        ).toBe(`client-${index}`);
        if ('content' in result.value)
          expect(result.value.content).toBe(`client ${index} content`);
      }
      expect(fixture.state.creations.size).toBe(2);
      expect(
        fixture.calls.filter((call) =>
          ['DELETE', 'PATCH', 'PUT'].includes(call.method),
        ),
      ).toEqual([]);
    } finally {
      release();
      await outcomes;
    }
  },
);

test('post-create name reconciliation follows pages and ignores only the generated ID', async () => {
  fixture.state.override = (url, response) => {
    if (url.pathname !== '/drive/v3/files') return false;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify(
        url.searchParams.has('pageToken')
          ? { files: [{ id: 'another-client' }] }
          : { files: [{ id: 'own-id' }], nextPageToken: 'next' },
      ),
    );
    return true;
  };
  expect(
    await drive.creationNameConflict(
      'fixture-access',
      'own-id',
      'root',
      "Team's notes.md",
    ),
  ).toBe(true);
  expect(
    fixture.calls.filter((call) => call.url.pathname === '/drive/v3/files'),
  ).toHaveLength(2);
  expect(fixture.calls.at(-1)?.url.searchParams.get('pageToken')).toBe('next');
});

test.each(['documents', 'folders'] as const)(
  'an incomplete post-create lookup leaves %s unconfirmed without replaying or deleting the acknowledged creation',
  async (kind) => {
    fixture.state.override = (url, response) => {
      if (!url.searchParams.get('fields')?.includes('incompleteSearch'))
        return false;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ files: [], incompleteSearch: true }));
      return true;
    };
    const id = await drive.prepareCreate('fixture-access', 'root', 'new.md');
    await expect(
      kind === 'folders'
        ? drive.createFolder(
            'fixture-access',
            id,
            'root',
            'new.md',
            'operation',
            () => {},
          )
        : drive.create(
            'fixture-access',
            id,
            'root',
            'new.md',
            'draft',
            'operation',
            () => {},
          ),
    ).rejects.toMatchObject({ code: 'unconfirmed' });
    expect(fixture.state.created?.id).toBe(id);
    expect(fixture.calls.filter((call) => call.method === 'POST')).toHaveLength(
      1,
    );
    expect(fixture.calls.some((call) => call.method === 'DELETE')).toBe(false);
  },
);
