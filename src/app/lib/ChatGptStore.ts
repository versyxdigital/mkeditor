import { randomUUID } from 'crypto';
import { safeStorage } from 'electron';
import { AssistantKeyStore } from './AssistantKeyStore';
import { loadAssistantStore, writeAssistantStore } from './assistantStoreFile';

export interface ChatGptTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
}

export interface ChatGptAccount {
  id: string;
  subject: string;
  email: string;
  encryptedTokens?: string;
  welcomed?: boolean;
  planEnabled?: boolean;
}

export interface ChatGptStore {
  hostId: string;
  mode: 'api-key' | 'chatgpt';
  activeId?: string;
  accounts: ChatGptAccount[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate this optional section independently so old stores remain usable. */
export function loadChatGptStore(): ChatGptStore {
  const raw = loadAssistantStore().chatgpt;
  const value = isRecord(raw) ? raw : {};
  return {
    hostId:
      typeof value.hostId === 'string' &&
      /^urn:uuid:[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
        value.hostId,
      )
        ? value.hostId
        : '',
    mode: value.mode === 'chatgpt' ? 'chatgpt' : 'api-key',
    activeId: typeof value.activeId === 'string' ? value.activeId : undefined,
    accounts: Array.isArray(value.accounts)
      ? value.accounts.filter(
          (a): a is ChatGptAccount =>
            isRecord(a) &&
            typeof a.id === 'string' &&
            a.id.length > 0 &&
            a.id !== 'dynamic_agent_client' &&
            typeof a.subject === 'string' &&
            a.subject.length > 0 &&
            typeof a.email === 'string' &&
            (a.encryptedTokens === undefined ||
              typeof a.encryptedTokens === 'string') &&
            (a.welcomed === undefined || typeof a.welcomed === 'boolean') &&
            (a.planEnabled === undefined || typeof a.planEnabled === 'boolean'),
        )
      : [],
  };
}

export function saveChatGptStore(value: ChatGptStore): void {
  const store = loadAssistantStore();
  store.chatgpt = value;
  if (!writeAssistantStore(store)) throw new Error('storage_failed');
}

export function ensureChatGptHost(): ChatGptStore {
  const store = loadChatGptStore();
  if (!store.hostId) {
    store.hostId = `urn:uuid:${randomUUID()}`;
    saveChatGptStore(store);
  }
  return store;
}

export async function encryptChatGptTokens(
  tokens: ChatGptTokens,
): Promise<string> {
  if (!(await AssistantKeyStore.isEncryptionAvailable()))
    throw new Error('storage_failed');
  try {
    return (
      await safeStorage.encryptStringAsync(JSON.stringify(tokens))
    ).toString('base64');
  } catch {
    throw new Error('storage_failed');
  }
}

export async function decryptChatGptTokens(
  account: ChatGptAccount,
): Promise<ChatGptTokens | null> {
  if (
    !account.encryptedTokens ||
    !(await AssistantKeyStore.isEncryptionAvailable())
  )
    return null;
  try {
    const { result } = await safeStorage.decryptStringAsync(
      Buffer.from(account.encryptedTokens, 'base64'),
    );
    const value: unknown = JSON.parse(result);
    if (
      !isRecord(value) ||
      typeof value.accessToken !== 'string' ||
      !value.accessToken ||
      typeof value.refreshToken !== 'string' ||
      !value.refreshToken ||
      typeof value.idToken !== 'string' ||
      !value.idToken ||
      typeof value.expiresAt !== 'number' ||
      !Number.isFinite(value.expiresAt) ||
      !Array.isArray(value.scopes) ||
      !value.scopes.every((s) => typeof s === 'string')
    )
      return null;
    return value as unknown as ChatGptTokens;
  } catch {
    return null;
  }
}
