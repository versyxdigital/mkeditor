/** @jest-environment node */
import { get } from 'http';
import { shell } from 'electron';
import { callbackCopy } from './fixtures/chatgptCallbackCopy';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'trusted-keys'),
  jwtVerify: jest.fn(),
}));

let oauth: typeof import('../src/app/lib/ChatGptOAuth');
let verify: jest.Mock;
let fetchMock: jest.Mock;
let login: ReturnType<typeof oauth.startChatGptLogin> | undefined;
const originalFetch = global.fetch;

async function authorizationUrl(): Promise<URL> {
  for (let i = 0; i < 20; i++) {
    const calls = jest.mocked(shell.openExternal).mock.calls;
    if (calls.length) return new URL(calls[calls.length - 1][0]);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Browser did not open');
}

function callback(
  authorize: URL,
  values: Record<string, string>,
): Promise<number> {
  const url = new URL(authorize.searchParams.get('redirect_uri')!);
  url.search = new URLSearchParams(values).toString();
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      response.resume();
      resolve(response.statusCode!);
    }).on('error', reject);
  });
}

function callbackPage(
  authorize: URL,
  values: Record<string, string>,
): Promise<{
  status: number;
  body: string;
  headers: import('http').IncomingHttpHeaders;
}> {
  const url = new URL(authorize.searchParams.get('redirect_uri')!);
  url.search = new URLSearchParams(values).toString();
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () =>
        resolve({
          status: response.statusCode!,
          body,
          headers: response.headers,
        }),
      );
    }).on('error', reject);
  });
}

beforeEach(() => {
  jest.resetModules();
  // Use the same mock instance as the module reloaded below.
  const electron = require('electron');
  electron.shell.openExternal.mockReset().mockResolvedValue(undefined);
  jest.mocked(shell.openExternal).mockReset().mockResolvedValue(undefined);
  oauth = require('../src/app/lib/ChatGptOAuth');
  verify = require('jose').jwtVerify;
  verify.mockReset();
  fetchMock = jest.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes('openid-configuration')
        ? {
            issuer: 'https://auth.openai.com',
            jwks_uri: 'https://auth.openai.com/jwks',
          }
        : {
            access_token: 'access',
            refresh_token: 'refresh',
            id_token: 'identity',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid resource.invoke chatgpt.tokens.use.direct',
          },
  }));
  global.fetch = fetchMock;
});

afterEach(() => {
  login?.cancel();
  login = undefined;
  global.fetch = originalFetch;
});

// resetModules creates a fresh electron mock; read its calls directly.
async function browserUrl(): Promise<URL> {
  const currentShell = require('electron').shell;
  for (let i = 0; i < 20; i++) {
    const calls = currentShell.openExternal.mock.calls;
    if (calls.length) return new URL(calls.at(-1)[0]);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return authorizationUrl();
}

test('registers with PKCE and nonce, validates state and exchanges the issued client ID', async () => {
  login = oauth.startChatGptLogin({
    hostId: 'urn:uuid:host',
    page: callbackCopy,
  });
  const pendingLogin = login;
  void pendingLogin.result.then(() => pendingLogin.finish('success'));
  const url = await browserUrl();
  expect(url.origin).toBe('https://auth.openai.com');
  expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client');
  expect(url.searchParams.get('agent_name_hint')).toBe('MKEditor');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
  verify.mockResolvedValue({
    payload: {
      sub: 'writer',
      email: 'writer@example.com',
      nonce: url.searchParams.get('nonce'),
    },
  });
  expect(
    await callback(url, {
      code: 'code',
      state: 'wrong-state',
      client_id: 'oaiapp_issued',
    }),
  ).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
  await callback(url, {
    code: 'code',
    state: url.searchParams.get('state')!,
    client_id: 'oaiapp_issued',
  });
  await expect(login.result).resolves.toMatchObject({
    clientId: 'oaiapp_issued',
    subject: 'writer',
  });
  const form = fetchMock.mock.calls[0][1].body as URLSearchParams;
  expect(form.get('client_id')).toBe('oaiapp_issued');
  expect(form.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'));
  expect(form.get('resource')).toBe('https://api.openai.com/v1');
  expect(verify).toHaveBeenCalledWith(
    'identity',
    'trusted-keys',
    expect.objectContaining({
      issuer: 'https://auth.openai.com',
      audience: 'oaiapp_issued',
      algorithms: ['RS256'],
    }),
  );
});

test.each(['missing-client', 'changed-client', 'denied'] as const)(
  'rejects %s without exchanging a code',
  async (scenario) => {
    login = oauth.startChatGptLogin({
      page: callbackCopy,
      hostId: 'urn:uuid:host',
      ...(scenario === 'changed-client' ? { clientId: 'oaiapp_saved' } : {}),
    });
    const failure = expect(login.result).rejects.toThrow();
    const url = await browserUrl();
    await callback(url, {
      code: 'code',
      state: url.searchParams.get('state')!,
      ...(scenario === 'changed-client'
        ? { client_id: 'oaiapp_attacker' }
        : {}),
      ...(scenario === 'denied' ? { error: 'access_denied' } : {}),
    });
    await failure;
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test.each(['signature', 'nonce'] as const)(
  'rejects an invalid %s',
  async (scenario) => {
    login = oauth.startChatGptLogin({
      hostId: 'urn:uuid:host',
      page: callbackCopy,
    });
    const failure = expect(login.result).rejects.toThrow();
    const url = await browserUrl();
    if (scenario === 'signature')
      verify.mockRejectedValue(new Error('Invalid signature'));
    else
      verify.mockResolvedValue({ payload: { sub: 'writer', nonce: 'wrong' } });
    await callback(url, {
      code: 'code',
      state: url.searchParams.get('state')!,
      client_id: 'oaiapp_issued',
    });
    await failure;
  },
);

test('cancel closes the listener and rejects the pending attempt', async () => {
  login = oauth.startChatGptLogin({
    hostId: 'urn:uuid:host',
    page: callbackCopy,
  });
  const failure = expect(login.result).rejects.toThrow('cancelled');
  const url = await browserUrl();
  login.cancel();
  await failure;
  await expect(
    callback(url, { state: url.searchParams.get('state')! }),
  ).rejects.toThrow();
});

test('browser success waits for persistence acknowledgement, contains no OAuth data and scrubs the address bar', async () => {
  login = oauth.startChatGptLogin({
    hostId: 'urn:uuid:host',
    page: callbackCopy,
  });
  const url = await browserUrl();
  verify.mockResolvedValue({
    payload: { sub: 'writer', nonce: url.searchParams.get('nonce') },
  });
  let responded = false;
  const browser = callbackPage(url, {
    code: 'private-authorization-code',
    state: url.searchParams.get('state')!,
    client_id: 'oaiapp_issued',
  }).then((value) => {
    responded = true;
    return value;
  });
  await login.result;
  expect(responded).toBe(false);
  login.finish('success');
  const page = await browser;
  expect(page.status).toBe(200);
  expect(page.body).toContain(callbackCopy.successTitle);
  expect(page.body).toContain(callbackCopy.returnToApp);
  expect(page.body).toContain(
    "history.replaceState(null, '', '/auth/complete')",
  );
  expect(page.body).not.toContain('private-authorization-code');
  expect(page.body).not.toContain('oaiapp_issued');
  expect(page.headers['cache-control']).toBe('no-store');
  expect(page.headers['referrer-policy']).toBe('no-referrer');
  expect(page.headers['content-security-policy']).toContain(
    "default-src 'none'",
  );
});

test('persistence failure produces a failure page instead of success', async () => {
  login = oauth.startChatGptLogin({
    hostId: 'urn:uuid:host',
    page: callbackCopy,
  });
  const url = await browserUrl();
  verify.mockResolvedValue({
    payload: { sub: 'writer', nonce: url.searchParams.get('nonce') },
  });
  const browser = callbackPage(url, {
    code: 'code',
    state: url.searchParams.get('state')!,
    client_id: 'oaiapp_issued',
  });
  await login.result;
  login.finish('error');
  const page = await browser;
  expect(page.body).toContain('Sign-in wasn’t completed');
  expect(page.body).not.toContain(callbackCopy.successTitle);
});
