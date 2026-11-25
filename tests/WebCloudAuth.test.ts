import { webcrypto, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { WebCloudAuth } from '../src/browser/core/cloud/WebCloudAuth';
import { webCloudRegistration } from '../scripts/web-cloud-registration.cjs';

const config = {
  googleClientId: 'fixture.apps.googleusercontent.com',
  dropboxAppKey: 'fixture-app-key',
};
const scope = ['files.content.read'];
type TokenConfig = {
  scope: string;
  state: string;
  callback: (data: unknown) => void;
  error_callback: (error: { type: string }) => void;
};
let googleRequests: TokenConfig[];
let requestAccessToken: jest.Mock;
let auth: WebCloudAuth;
let popup: Window;
let fetchMock: jest.Mock;
const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

function token(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'short-lived-token',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: scope.join(' '),
    refresh_token: 'must-discard',
    ...overrides,
  };
}

function googleResult(index = 0, overrides: Record<string, unknown> = {}) {
  googleRequests[index].callback({
    ...token(),
    state: googleRequests[index].state,
    ...overrides,
  });
}

async function authorizationUrl(): Promise<URL> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (popup.location.href !== 'about:blank')
      return new URL(popup.location.href);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Missing authorization URL');
}

function callback(
  url: URL,
  overrides: { origin?: string; source?: Window; callbackUrl?: string } = {},
) {
  const redirect = new URL(url.searchParams.get('redirect_uri')!);
  redirect.search = new URLSearchParams({
    state: url.searchParams.get('state')!,
    code: 'one-time-code',
  }).toString();
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: overrides.origin ?? window.location.origin,
      source: overrides.source ?? popup,
      data: {
        type: 'mkeditor-cloud-oauth',
        url: overrides.callbackUrl ?? redirect.href,
      },
    }),
  );
}

beforeEach(() => {
  jest.useRealTimers();
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  window.history.replaceState(null, '', '/editor/index.html');
  googleRequests = [];
  requestAccessToken = jest.fn();
  Object.assign(window, {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: jest.fn((options: TokenConfig) => {
            googleRequests.push(options);
            return { requestAccessToken };
          }),
        },
      },
    },
  });
  popup = {
    location: { href: 'about:blank' },
    closed: false,
    close: jest.fn(),
  } as unknown as Window;
  jest.spyOn(window, 'open').mockReturnValue(popup);
  fetchMock = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => token() });
  globalThis.fetch = fetchMock;
  auth = new WebCloudAuth(config);
});

afterEach(() => {
  auth.dispose();
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete (window as Window & { google?: unknown }).google;
  if (cryptoDescriptor)
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
});

test('Google token request stays in the click stack and returns only a short-lived token', async () => {
  const persist = jest.spyOn(Storage.prototype, 'setItem');
  const flow = auth.beginAuthorization('google-drive', scope);
  expect(requestAccessToken).toHaveBeenCalledTimes(1);
  googleResult();
  const tokens = await flow.result;
  expect(tokens).toEqual({
    access: 'short-lived-token',
    refresh: '',
    expires: expect.any(Number),
    scopes: scope,
  });
  expect(tokens.expires).toBeGreaterThan(Date.now() + 3_500_000);
  expect(JSON.stringify(tokens)).not.toContain('must-discard');
  expect(persist).not.toHaveBeenCalled();
});

test('GIS script load failure is recoverable and an unconfigured provider loads no script', async () => {
  const global = window as Window & { google?: unknown };
  const google = global.google;
  delete global.google;
  const missing = new WebCloudAuth({ googleClientId: '', dropboxAppKey: '' });
  await missing.prepare();
  expect(
    document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]',
    ),
  ).toBeNull();
  const failed = auth.prepare();
  const firstScript = document.querySelector<HTMLScriptElement>(
    'script[src="https://accounts.google.com/gsi/client"]',
  )!;
  firstScript.dispatchEvent(new Event('error'));
  await expect(failed).rejects.toMatchObject({ code: 'network' });
  expect(firstScript.isConnected).toBe(false);
  const ready = auth.prepare();
  const retryScript = document.querySelector<HTMLScriptElement>(
    'script[src="https://accounts.google.com/gsi/client"]',
  )!;
  global.google = google;
  retryScript.dispatchEvent(new Event('load'));
  await ready;
  expect(retryScript).not.toBe(firstScript);
  retryScript.remove();
  missing.dispose();
});

test('Google callbacks are one-shot and isolated between parallel account requests', async () => {
  const first = auth.beginAuthorization('google-drive', scope);
  const second = auth.beginAuthorization('google-drive', scope);
  expect(googleRequests[0].state).not.toBe(googleRequests[1].state);
  googleResult(1, { access_token: 'second-account' });
  first.cancel();
  googleResult(0, { access_token: 'late-account' });
  await expect(first.result).rejects.toMatchObject({ code: 'cancelled' });
  await expect(second.result).resolves.toMatchObject({
    access: 'second-account',
  });
});

test('a consolidated full Drive grant satisfies its overlapping read-only grant', async () => {
  const read = 'https://www.googleapis.com/auth/drive.readonly';
  const write = 'https://www.googleapis.com/auth/drive';
  const flow = auth.beginAuthorization('google-drive', [read, write]);
  googleResult(0, { scope: write });
  await expect(flow.result).resolves.toMatchObject({ scopes: [write] });
});

test.each([
  [{ state: 'wrong-state' }, 'auth'],
  [{ state: undefined }, 'auth'],
  [{ scope: '' }, 'permission'],
  [{ expires_in: 0 }, 'auth'],
  [{ expires_in: 'Infinity' }, 'auth'],
  [{ token_type: 'MAC' }, 'auth'],
  [{ error: 'access_denied' }, 'cancelled'],
])('Google rejects invalid callback response %j', async (overrides, code) => {
  const flow = auth.beginAuthorization('google-drive', scope);
  googleResult(0, overrides as Record<string, unknown>);
  await expect(flow.result).rejects.toMatchObject({ code });
});

test.each([
  ['popup_closed', 'cancelled'],
  ['popup_failed_to_open', 'auth'],
  ['unknown', 'auth'],
])(
  'Google reports popup error %s without retaining a live flow',
  async (type, code) => {
    const flow = auth.beginAuthorization('google-drive', scope);
    googleRequests[0].error_callback({ type });
    await expect(flow.result).rejects.toMatchObject({ code });
  },
);

test('Google authorization times out and ignores late token callbacks', async () => {
  jest.useFakeTimers();
  auth = new WebCloudAuth(config, { timeoutMs: 500 });
  const flow = auth.beginAuthorization('google-drive', scope);
  jest.advanceTimersByTime(500);
  googleResult();
  await expect(flow.result).rejects.toMatchObject({ code: 'cancelled' });
});

test('Dropbox reserves the popup synchronously, uses S256 online PKCE and discards refresh tokens', async () => {
  const flow = auth.beginAuthorization('dropbox', scope);
  expect(window.open).toHaveBeenCalledWith(
    'about:blank',
    '_blank',
    expect.any(String),
  );
  const url = await authorizationUrl();
  expect(url.origin).toBe('https://www.dropbox.com');
  expect(url.searchParams.get('token_access_type')).toBe('online');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('redirect_uri')).toBe(
    `${window.location.origin}/editor/cloud-callback.html`,
  );
  callback(url);
  const tokens = await flow.result;
  expect(tokens.refresh).toBe('');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [endpoint, request] = fetchMock.mock.calls[0];
  expect(endpoint).toBe('https://api.dropboxapi.com/oauth2/token');
  const form = request.body as URLSearchParams;
  const challenge = createHash('sha256')
    .update(form.get('code_verifier')!)
    .digest('base64url');
  expect(challenge).toBe(url.searchParams.get('code_challenge'));
  expect(form.get('client_id')).toBe(config.dropboxAppKey);
  expect(form.has('client_secret')).toBe(false);
  expect(form.has('refresh_token')).toBe(false);
  expect(request).toMatchObject({
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
  });
});

test.each([
  'wrong-origin',
  'wrong-source',
  'wrong-state',
  'wrong-path',
  'duplicate-state',
  'duplicate-code',
  'code-and-error',
  'hash',
  'credentials',
])(
  'Dropbox ignores forged callback %s without consuming valid authorization',
  async (kind) => {
    const flow = auth.beginAuthorization('dropbox', scope);
    const url = await authorizationUrl();
    const response = new URL(url.searchParams.get('redirect_uri')!);
    response.search = new URLSearchParams({
      state: url.searchParams.get('state')!,
      code: 'code',
    }).toString();
    if (kind === 'wrong-state') response.searchParams.set('state', 'forged');
    if (kind === 'wrong-path') response.pathname = '/wrong';
    if (kind === 'duplicate-state')
      response.searchParams.append('state', 'forged');
    if (kind === 'duplicate-code')
      response.searchParams.append('code', 'forged');
    if (kind === 'code-and-error')
      response.searchParams.append('error', 'access_denied');
    if (kind === 'hash') response.hash = 'fragment';
    if (kind === 'credentials') response.username = 'forged';
    callback(url, {
      callbackUrl: response.href,
      ...(kind === 'wrong-origin' ? { origin: 'https://evil.example' } : {}),
      ...(kind === 'wrong-source' ? { source: window } : {}),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    callback(url);
    callback(url);
    await expect(flow.result).resolves.toMatchObject({
      access: 'short-lived-token',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

test('Dropbox blocked popup fails without token exchange', async () => {
  jest.mocked(window.open).mockReturnValue(null);
  const flow = auth.beginAuthorization('dropbox', scope);
  await expect(flow.result).rejects.toMatchObject({ code: 'auth' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('Dropbox consumes a popup reserved before queued service work without opening another', async () => {
  const release = auth.reserveAuthorization('dropbox');
  expect(window.open).toHaveBeenCalledTimes(1);
  const flow = auth.beginAuthorization('dropbox', scope);
  const url = await authorizationUrl();
  release();
  expect(popup.close).not.toHaveBeenCalled();
  callback(url);
  await expect(flow.result).resolves.toMatchObject({ refresh: '' });
  expect(window.open).toHaveBeenCalledTimes(1);
});

test('unused Dropbox reservations close when released or disposed', () => {
  const release = auth.reserveAuthorization('dropbox');
  release();
  release();
  expect(popup.close).toHaveBeenCalledTimes(1);
  auth.reserveAuthorization('dropbox');
  auth.dispose();
  expect(popup.close).toHaveBeenCalledTimes(2);
});

test('blocked reserved popup fails instead of opening a second popup outside the gesture', async () => {
  jest.mocked(window.open).mockReturnValue(null);
  const release = auth.reserveAuthorization('dropbox');
  jest.mocked(window.open).mockReturnValue(popup);
  const flow = auth.beginAuthorization('dropbox', scope);
  await expect(flow.result).rejects.toMatchObject({ code: 'auth' });
  release();
  expect(window.open).toHaveBeenCalledTimes(1);
});

test('a reservation closed before queued authorization returns cancellation', async () => {
  auth.reserveAuthorization('dropbox');
  Object.defineProperty(popup, 'closed', { value: true });
  await expect(
    auth.beginAuthorization('dropbox', scope).result,
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('Dropbox timeout closes the popup and late callback cannot exchange a code', async () => {
  jest.useFakeTimers();
  jest.spyOn(webcrypto.subtle, 'digest').mockResolvedValue(new ArrayBuffer(32));
  auth = new WebCloudAuth(config, { timeoutMs: 5_000 });
  const flow = auth.beginAuthorization('dropbox', scope);
  await Promise.resolve();
  const url = await authorizationUrl();
  jest.advanceTimersByTime(5_000);
  callback(url);
  await expect(flow.result).rejects.toMatchObject({ code: 'cancelled' });
  expect(popup.close).toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('Dropbox popup closure cancels the flow', async () => {
  jest.useFakeTimers();
  const flow = auth.beginAuthorization('dropbox', scope);
  Object.defineProperty(popup, 'closed', { value: true });
  jest.advanceTimersByTime(250);
  await expect(flow.result).rejects.toMatchObject({ code: 'cancelled' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('a valid callback remains open until its queued message reaches the parent', async () => {
  jest.useFakeTimers();
  jest.spyOn(webcrypto.subtle, 'digest').mockResolvedValue(new ArrayBuffer(32));
  jest.mocked(popup.close).mockImplementation(() => {
    Object.defineProperty(popup, 'closed', { value: true, configurable: true });
  });
  const flow = auth.beginAuthorization('dropbox', scope);
  await Promise.resolve();
  const url = await authorizationUrl();
  const response = new URL(url.searchParams.get('redirect_uri')!);
  response.search = new URLSearchParams({
    state: url.searchParams.get('state')!,
    code: 'one-time-code',
  }).toString();
  const opener = {
    postMessage: (data: unknown, origin: string) => {
      // A different task source can deliver the posted message after closure polling.
      setTimeout(() => {
        window.dispatchEvent(
          new MessageEvent('message', { origin, source: popup, data }),
        );
      }, 300);
    },
  };
  runInNewContext(readFileSync('src/browser/views/cloud-callback.js', 'utf8'), {
    window: { opener, close: () => popup.close() },
    location: {
      href: response.href,
      pathname: response.pathname,
      origin: response.origin,
    },
    history: { replaceState: jest.fn() },
  });
  await jest.advanceTimersByTimeAsync(300);
  await expect(flow.result).resolves.toMatchObject({
    access: 'short-lived-token',
  });
  expect(popup.close).toHaveBeenCalledTimes(1);
});

test('Dropbox cancellation aborts code exchange and discards a late successful reply', async () => {
  let reply!: (response: unknown) => void;
  fetchMock.mockReturnValue(
    new Promise((resolve) => {
      reply = resolve;
    }),
  );
  const flow = auth.beginAuthorization('dropbox', scope);
  const url = await authorizationUrl();
  callback(url);
  flow.cancel();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  reply({ ok: true, json: async () => token() });
  await expect(flow.result).rejects.toMatchObject({ code: 'cancelled' });
});

test('Dropbox access denial is cancellation and does not exchange a code', async () => {
  const flow = auth.beginAuthorization('dropbox', scope);
  const url = await authorizationUrl();
  const response = new URL(url.searchParams.get('redirect_uri')!);
  response.search = new URLSearchParams({
    state: url.searchParams.get('state')!,
    error: 'access_denied',
  }).toString();
  callback(url, { callbackUrl: response.href });
  await expect(flow.result).rejects.toMatchObject({ code: 'cancelled' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('public web registration ignores desktop secrets and rejects malformed identifiers', () => {
  expect(
    webCloudRegistration({
      MKEDITOR_WEB_GOOGLE_CLIENT_ID: config.googleClientId,
      MKEDITOR_WEB_DROPBOX_APP_KEY: config.dropboxAppKey,
      MKEDITOR_GOOGLE_CLIENT_SECRET: 'never-bundle',
      MKEDITOR_GOOGLE_CLIENT_ID: 'desktop.apps.googleusercontent.com',
      MKEDITOR_DROPBOX_APP_KEY: 'desktop-key',
    }),
  ).toEqual(config);
  expect(
    webCloudRegistration({ MKEDITOR_GOOGLE_CLIENT_SECRET: 'never-bundle' }),
  ).toEqual({ googleClientId: '', dropboxAppKey: '' });
  expect(() =>
    webCloudRegistration({ MKEDITOR_WEB_GOOGLE_CLIENT_ID: 'invalid' }),
  ).toThrow('Invalid Google');
  expect(() =>
    webCloudRegistration({ MKEDITOR_WEB_DROPBOX_APP_KEY: 'a b' }),
  ).toThrow('Invalid Dropbox');
});

test('unconfigured and disposed authentication never open provider popups', async () => {
  const empty = new WebCloudAuth({ googleClientId: '', dropboxAppKey: '' });
  await expect(
    empty.beginAuthorization('dropbox', scope).result,
  ).rejects.toMatchObject({ code: 'configuration' });
  empty.dispose();
  auth.dispose();
  await expect(
    auth.beginAuthorization('google-drive', scope).result,
  ).rejects.toMatchObject({ code: 'configuration' });
  expect(window.open).not.toHaveBeenCalled();
});

test('static callback scrubs code before relaying to the exact same-origin opener', () => {
  const postMessage = jest.fn();
  const replaceState = jest.fn();
  const close = jest.fn();
  const location = {
    href: 'https://editor.example/sub/cloud-callback.html?code=private&state=nonce',
    pathname: '/sub/cloud-callback.html',
    origin: 'https://editor.example',
  };
  runInNewContext(readFileSync('src/browser/views/cloud-callback.js', 'utf8'), {
    window: { opener: { postMessage }, close },
    location,
    history: { replaceState },
  });
  expect(replaceState).toHaveBeenCalledWith(
    null,
    '',
    '/sub/cloud-callback.html',
  );
  expect(postMessage).toHaveBeenCalledWith(
    { type: 'mkeditor-cloud-oauth', url: location.href },
    location.origin,
  );
  expect(close).not.toHaveBeenCalled();
});

test('standalone or expired callbacks scrub credentials and keep a language-neutral fallback', () => {
  const page = new DOMParser().parseFromString(
    readFileSync('src/browser/views/cloud-callback.html', 'utf8'),
    'text/html',
  );
  expect(page.title).toBe('MKEditor');
  expect(page.querySelector('main')?.textContent).toBe('MKEditor');
  const replaceState = jest.fn();
  const close = jest.fn();
  runInNewContext(readFileSync('src/browser/views/cloud-callback.js', 'utf8'), {
    window: { opener: null, close },
    location: {
      href: 'https://editor.example/sub/cloud-callback.html?code=expired&state=old',
      pathname: '/sub/cloud-callback.html',
      origin: 'https://editor.example',
    },
    history: { replaceState },
  });
  expect(replaceState).toHaveBeenCalledWith(
    null,
    '',
    '/sub/cloud-callback.html',
  );
  expect(close).not.toHaveBeenCalled();
});
