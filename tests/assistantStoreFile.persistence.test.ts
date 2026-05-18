/**
 * assistantStoreFile — P7 persisted-conversations round-trip tests.
 *
 * Exercises the main-side load/write helpers added in P7
 * (`loadPersistedConversations` / `writePersistedConversations`)
 * against a per-test tmp `~/.mkeditor` directory. The atomic
 * tmp+rename + schema-fallback paths are already covered by the
 * existing `AssistantConfig.test.ts` / `AssistantKeyStore.test.ts`
 * suites that share the same helper module.
 *
 * Migration coverage: pre-P7 files (no `conversations` field) load
 * with `null`; the loader doesn't reject them.
 */

import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, normalize } from 'path';

type StoreModule = typeof import('../src/app/lib/assistantStoreFile');

function withTempHome<T>(fn: (tmpHome: string) => T): T {
  const tmpHome = mkdtempSync(join(tmpdir(), 'mkeditor-store-p7-'));
  try {
    return fn(tmpHome);
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
}

function loadStoreModule(tmpHome: string): StoreModule {
  jest.resetModules();
  jest.unmock('fs');
  jest.doMock('os', () => ({
    ...jest.requireActual('os'),
    homedir: () => tmpHome,
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../src/app/lib/assistantStoreFile') as StoreModule;
}

const fileFor = (tmpHome: string) =>
  normalize(tmpHome + '/.mkeditor/assistant.json');

describe('assistantStoreFile — P7 persisted conversations', () => {
  it('loadPersistedConversations returns null when the file does not exist', () => {
    withTempHome((tmpHome) => {
      const mod = loadStoreModule(tmpHome);
      expect(mod.loadPersistedConversations()).toBeNull();
    });
  });

  it('loadPersistedConversations returns null for a pre-P7 file (no conversations field) — MIGRATION PATH', () => {
    // Regression / migration: a v1 file written before P7 landed has
    // only `version`, `providers`, `keys`. Loader must accept it
    // (no rejection) and surface conversations as null so
    // AssistantManager.restore(null) is a no-op.
    withTempHome((tmpHome) => {
      mkdirSync(normalize(tmpHome + '/.mkeditor'), { recursive: true });
      writeFileSync(
        fileFor(tmpHome),
        JSON.stringify({
          version: 1,
          providers: {
            anthropic: { enabled: false, defaultModel: 'claude' },
            openai: { enabled: false, defaultModel: 'gpt' },
            ollama: {
              enabled: false,
              baseUrl: 'http://localhost:11434',
              defaultModel: 'llama',
            },
          },
          keys: {},
        }),
        { encoding: 'utf-8' },
      );
      const mod = loadStoreModule(tmpHome);
      expect(mod.loadPersistedConversations()).toBeNull();
    });
  });

  it('writePersistedConversations + loadPersistedConversations round-trips the payload verbatim', () => {
    withTempHome((tmpHome) => {
      const mod = loadStoreModule(tmpHome);
      const payload = {
        activeProvider: 'anthropic' as const,
        activeConversation: {
          anthropic: 'c-1',
          openai: null,
          ollama: null,
        },
        conversations: {
          anthropic: [
            {
              id: 'c-1',
              providerId: 'anthropic' as const,
              title: 'Round trip',
              model: 'claude-sonnet-4-6',
              messages: [
                {
                  id: 'm-1',
                  role: 'user' as const,
                  content: 'hello',
                  status: 'complete' as const,
                  createdAt: 1,
                },
              ],
              autoAcceptWrites: false,
              shareActiveFile: true,
              shareSelection: false,
              mentions: [],
              createdAt: 1,
              updatedAt: 2,
            },
          ],
          openai: [],
          ollama: [],
        },
        drafts: { 'anthropic:c-1': 'wip' },
      };
      expect(mod.writePersistedConversations(payload)).toBe(true);
      const back = mod.loadPersistedConversations();
      expect(back).toEqual(payload);
    });
  });

  it('writePersistedConversations preserves the providers + keys blocks (does not stomp sibling sections)', () => {
    withTempHome((tmpHome) => {
      const mod = loadStoreModule(tmpHome);
      // Seed a file with custom providers / keys.
      mkdirSync(normalize(tmpHome + '/.mkeditor'), { recursive: true });
      writeFileSync(
        fileFor(tmpHome),
        JSON.stringify({
          version: 1,
          providers: {
            anthropic: { enabled: true, defaultModel: 'claude-x' },
            openai: { enabled: false, defaultModel: 'gpt-x' },
            ollama: {
              enabled: false,
              baseUrl: 'http://localhost:11434',
              defaultModel: 'llama-x',
            },
          },
          keys: { anthropic: 'encrypted-key-bytes' },
        }),
        { encoding: 'utf-8' },
      );
      mod.writePersistedConversations({
        activeProvider: null,
        activeConversation: { anthropic: null, openai: null, ollama: null },
        conversations: { anthropic: [], openai: [], ollama: [] },
        drafts: {},
      });
      // Re-read raw JSON — providers + keys untouched.
      const raw = JSON.parse(readFileSync(fileFor(tmpHome), 'utf-8'));
      expect(raw.providers.anthropic).toEqual({
        enabled: true,
        defaultModel: 'claude-x',
      });
      expect(raw.keys).toEqual({ anthropic: 'encrypted-key-bytes' });
    });
  });

  it('writePersistedConversations(null) removes the conversations block (clear-history affordance)', () => {
    withTempHome((tmpHome) => {
      const mod = loadStoreModule(tmpHome);
      mod.writePersistedConversations({
        activeProvider: 'anthropic',
        activeConversation: {
          anthropic: 'c-1',
          openai: null,
          ollama: null,
        },
        conversations: {
          anthropic: [
            {
              id: 'c-1',
              providerId: 'anthropic',
              title: 'will be cleared',
              model: 'claude',
              messages: [],
              autoAcceptWrites: false,
              shareActiveFile: true,
              shareSelection: false,
              mentions: [],
              createdAt: 1,
              updatedAt: 2,
            },
          ],
          openai: [],
          ollama: [],
        },
        drafts: {},
      });
      expect(mod.loadPersistedConversations()).not.toBeNull();
      mod.writePersistedConversations(null);
      expect(mod.loadPersistedConversations()).toBeNull();
      // File still on disk and parseable (providers/keys preserved).
      const raw = JSON.parse(readFileSync(fileFor(tmpHome), 'utf-8'));
      expect(raw.conversations).toBeUndefined();
      expect(raw.providers).toBeDefined();
    });
  });
});
