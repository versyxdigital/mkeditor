/** @jest-environment node */
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ChatGptTokens } from '../src/app/lib/ChatGptStore';
import { callbackCopy } from './fixtures/chatgptCallbackCopy';

jest.mock('../src/app/lib/ChatGptOAuth', () => ({
  ...jest.requireActual('../src/app/lib/ChatGptOAuth'),
  startChatGptLogin: jest.fn(),
  exchangeChatGptTokens: jest.fn(),
  verifyChatGptIdentity: jest.fn(),
  openaiDiscovery: jest.fn(),
}));

let home: string;
let auth: import('../src/app/lib/ChatGptAuth').ChatGptAuth;
let store: typeof import('../src/app/lib/ChatGptStore');
let oauth: typeof import('../src/app/lib/ChatGptOAuth');
let changed: jest.Mock;
let stop: jest.Mock;
let fetchMock: jest.Mock;
const originalFetch = global.fetch;
const tokens = (overrides: Partial<ChatGptTokens> = {}): ChatGptTokens => ({
  accessToken: 'secret-access',
  refreshToken: 'secret-refresh',
  idToken: 'secret-identity',
  expiresAt: Date.now() + 3600000,
  scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'],
  ...overrides,
});

async function drain() {
  for (let i = 0; i < 65; i++) await Promise.resolve();
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'mkeditor-chatgpt-'));
  jest.resetModules();
  jest.doMock('os', () => ({
    ...jest.requireActual('os'),
    homedir: () => home,
  }));
  store = require('../src/app/lib/ChatGptStore');
  oauth = require('../src/app/lib/ChatGptOAuth');
  changed = jest.fn();
  stop = jest.fn();
  const { ChatGptAuth } = require('../src/app/lib/ChatGptAuth');
  auth = new ChatGptAuth(changed, stop);
  fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      models: [
        {
          slug: 'gpt-plan-model',
          display_name: 'Plan model',
          visibility: 'list',
        },
        { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' },
      ],
    }),
  }));
  global.fetch = fetchMock;
});

afterEach(() => {
  auth.dispose();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

async function signIn(
  value = tokens(),
  id = 'oaiapp_one',
  subject = 'user-one',
) {
  jest.mocked(oauth.startChatGptLogin).mockReturnValue({
    result: Promise.resolve({
      clientId: id,
      subject,
      email: 'writer@example.com',
      tokens: value,
    }),
    cancel: jest.fn(),
    finish: jest.fn(),
  });
  await auth.command({ action: 'sign-in', callback: callbackCopy });
  await drain();
}

test('stores encrypted tokens, preserves other sections and exposes only account/model metadata', async () => {
  const {
    loadAssistantStore,
    writeAssistantStore,
    assistantStorePath,
  } = require('../src/app/lib/assistantStoreFile');
  const existing = loadAssistantStore();
  existing.keys.openai = 'encrypted-api-key';
  writeAssistantStore(existing);
  await signIn();
  expect(auth.snapshot()).toMatchObject({
    mode: 'chatgpt',
    connected: true,
    welcome: true,
    models: [{ id: 'gpt-plan-model', label: 'Plan model' }],
  });
  expect(JSON.stringify(auth.snapshot())).not.toContain('secret-');
  expect(readFileSync(assistantStorePath(), 'utf8')).not.toContain('secret-');
  expect(loadAssistantStore().keys.openai).toBe('encrypted-api-key');
  expect(await auth.accessToken()).toBe('secret-access');
  expect(stop).toHaveBeenCalled();
  expect(
    jest.mocked(oauth.startChatGptLogin).mock.results.at(-1)!.value.finish,
  ).toHaveBeenCalledWith('success');
});

test('retains a stable host and issued client ID across sign-out and reauthorization', async () => {
  await signIn();
  const host = store.loadChatGptStore().hostId;
  jest.mocked(oauth.openaiDiscovery).mockResolvedValue({
    revocation_endpoint: 'https://auth.openai.com/revoke',
  });
  await auth.command({ action: 'sign-out' });
  expect(auth.snapshot()).toMatchObject({
    connected: false,
    activeId: 'oaiapp_one',
  });
  jest.mocked(oauth.startChatGptLogin).mockReturnValue({
    result: Promise.resolve({
      clientId: 'oaiapp_one',
      subject: 'user-one',
      email: '',
      tokens: tokens(),
    }),
    cancel: jest.fn(),
    finish: jest.fn(),
  });
  await auth.command({
    action: 'sign-in',
    accountId: 'oaiapp_one',
    callback: callbackCopy,
  });
  await drain();
  expect(oauth.startChatGptLogin).toHaveBeenLastCalledWith(
    expect.objectContaining({
      hostId: host,
      clientId: 'oaiapp_one',
      idTokenHint: undefined,
    }),
  );
});

test('missing plan permission retains identity without enabling inference or showing a welcome', async () => {
  await signIn(tokens({ scopes: ['openid'] }));
  await expect(auth.accessToken()).rejects.toThrow('permission_required');
  expect(auth.snapshot()).toMatchObject({
    welcome: false,
    error: 'permission_required',
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    jest.mocked(oauth.startChatGptLogin).mock.results.at(-1)!.value.finish,
  ).toHaveBeenCalledWith('permission');
});

test('serializes refreshes and persists rotating refresh tokens before use', async () => {
  await signIn();
  const current = store.loadChatGptStore();
  current.accounts[0].encryptedTokens = await store.encryptChatGptTokens(
    tokens({ expiresAt: 1 }),
  );
  store.saveChatGptStore(current);
  jest
    .mocked(oauth.exchangeChatGptTokens)
    .mockResolvedValue(
      tokens({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
    );
  const [first, second] = await Promise.all([
    auth.accessToken(),
    auth.accessToken(),
  ]);
  expect(first).toBe('new-access');
  expect(second).toBe(first);
  expect(oauth.exchangeChatGptTokens).toHaveBeenCalledTimes(1);
  const saved = store.loadChatGptStore().accounts[0];
  expect(await store.decryptChatGptTokens(saved)).toMatchObject({
    refreshToken: 'new-refresh',
  });
  expect(oauth.exchangeChatGptTokens).toHaveBeenLastCalledWith(
    expect.objectContaining({
      client_id: 'oaiapp_one',
      refresh_token: 'secret-refresh',
    }),
    expect.anything(),
  );
});

test('a temporary refresh failure preserves credentials; a terminal failure retains the account mapping', async () => {
  await signIn();
  const current = store.loadChatGptStore();
  current.accounts[0].encryptedTokens = await store.encryptChatGptTokens(
    tokens({ expiresAt: 1 }),
  );
  store.saveChatGptStore(current);
  jest
    .mocked(oauth.exchangeChatGptTokens)
    .mockRejectedValue(new Error('offline'));
  await expect(auth.accessToken()).rejects.toThrow('offline');
  expect(auth.snapshot().connected).toBe(true);
  jest
    .mocked(oauth.exchangeChatGptTokens)
    .mockRejectedValue(new oauth.ChatGptAuthError('invalid_grant'));
  await expect(auth.accessToken()).rejects.toThrow('sign_in_required');
  expect(auth.snapshot()).toMatchObject({
    connected: false,
    activeId: 'oaiapp_one',
  });
});

test('cancel ignores a late sign-in and keeps the active account unchanged', async () => {
  await signIn();
  let finish!: (
    value: Awaited<ReturnType<typeof oauth.startChatGptLogin>['result']>,
  ) => void;
  const cancel = jest.fn();
  jest.mocked(oauth.startChatGptLogin).mockReturnValue({
    result: new Promise((resolve) => {
      finish = resolve;
    }),
    cancel,
    finish: jest.fn(),
  });
  await auth.command({ action: 'sign-in', callback: callbackCopy });
  await auth.command({ action: 'cancel' });
  finish({
    clientId: 'oaiapp_two',
    subject: 'user-two',
    email: '',
    tokens: tokens(),
  });
  await drain();
  expect(auth.snapshot()).toMatchObject({
    activeId: 'oaiapp_one',
    signingIn: false,
  });
  expect(store.loadChatGptStore().accounts).toHaveLength(1);
  expect(cancel).toHaveBeenCalled();
});

test('rejects a different identity when reauthorizing a saved account', async () => {
  await signIn();
  jest.mocked(oauth.startChatGptLogin).mockReturnValue({
    result: Promise.resolve({
      clientId: 'oaiapp_one',
      subject: 'wrong-user',
      email: '',
      tokens: tokens(),
    }),
    cancel: jest.fn(),
    finish: jest.fn(),
  });
  await auth.command({
    action: 'sign-in',
    accountId: 'oaiapp_one',
    callback: callbackCopy,
  });
  await drain();
  expect(store.loadChatGptStore().accounts[0].subject).toBe('user-one');
  expect(auth.snapshot().error).toBe('sign_in_failed');
});

test('reports unconfirmed revocation and signs out locally without changing the billing mode', async () => {
  await signIn();
  jest.mocked(oauth.openaiDiscovery).mockRejectedValue(new Error('offline'));
  await auth.command({ action: 'sign-out' });
  expect(auth.snapshot()).toMatchObject({
    connected: false,
    mode: 'chatgpt',
    error: 'revocation_unconfirmed',
  });
  await expect(auth.accessToken()).rejects.toThrow('sign_in_required');
});

test('a refresh completing after sign-out cannot resurrect credentials', async () => {
  await signIn();
  const current = store.loadChatGptStore();
  current.accounts[0].encryptedTokens = await store.encryptChatGptTokens(
    tokens({ expiresAt: 1 }),
  );
  store.saveChatGptStore(current);
  let finish!: (value: ChatGptTokens) => void;
  jest.mocked(oauth.exchangeChatGptTokens).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const refreshing = auth.accessToken();
  await drain();
  jest.mocked(oauth.openaiDiscovery).mockRejectedValue(new Error('offline'));
  const signingOut = auth.command({ action: 'sign-out' });
  await drain();
  finish(tokens());
  await refreshing;
  await signingOut;
  expect(auth.snapshot().connected).toBe(false);
});

test('failed encryption preserves the existing connection and reports a storage failure', async () => {
  await signIn();
  const { safeStorage } = require('electron');
  safeStorage.encryptStringAsync.mockRejectedValueOnce(
    new Error('keychain unavailable'),
  );
  await signIn(tokens(), 'oaiapp_two', 'user-two');
  expect(auth.snapshot()).toMatchObject({
    activeId: 'oaiapp_one',
    error: 'storage_failed',
  });
  const attempt = jest
    .mocked(oauth.startChatGptLogin)
    .mock.results.at(-1)!.value;
  expect(attempt.finish).toHaveBeenCalledWith('error');
  expect(attempt.finish).not.toHaveBeenCalledWith('success');
  expect(store.loadChatGptStore().accounts).toHaveLength(1);
});

test('new inference is blocked while remote sign-out is pending', async () => {
  await signIn();
  let complete!: (value: Record<string, unknown>) => void;
  jest.mocked(oauth.openaiDiscovery).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const signingOut = auth.command({ action: 'sign-out' });
  await drain();
  await expect(auth.accessToken(true)).rejects.toThrow('sign_in_required');
  complete({ revocation_endpoint: 'https://auth.openai.com/revoke' });
  await signingOut;
  expect(auth.snapshot().connected).toBe(false);
});

test('window disposal preserves a rotating token for relaunch without returning it to the closed session', async () => {
  await signIn();
  const current = store.loadChatGptStore();
  current.accounts[0].encryptedTokens = await store.encryptChatGptTokens(
    tokens({ expiresAt: 1 }),
  );
  store.saveChatGptStore(current);
  let complete!: (value: ChatGptTokens) => void;
  jest.mocked(oauth.exchangeChatGptTokens).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const refreshing = auth.accessToken();
  await drain();
  auth.dispose();
  complete(tokens({ refreshToken: 'replacement-for-relaunch' }));
  await expect(refreshing).rejects.toThrow('sign_in_required');
  expect(
    await store.decryptChatGptTokens(store.loadChatGptStore().accounts[0]),
  ).toMatchObject({ refreshToken: 'replacement-for-relaunch' });
});
