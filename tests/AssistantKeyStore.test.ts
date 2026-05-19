/**
 * AssistantKeyStore unit tests.
 *
 * We point AssistantKeyStore + the shared `assistantStoreFile` helper at
 * a temporary home directory by stubbing `os.homedir` before requiring
 * the modules — same pattern as `AppSession.test.ts`. The `safeStorage`
 * mock from `tests/__mocks__/electron.js` provides a working
 * encrypt/decrypt round-trip by default; tests override individual
 * methods to cover unavailable / failing cases.
 *
 * Note on `jest.resetModules` inside `loadKeyStore`: it invalidates any
 * `safeStorage` handle the test file holds, so the helper returns a
 * fresh handle alongside the class. Tests must use the returned
 * `safeStorage` for per-test overrides — not a top-level import.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, normalize } from 'path';

type KeyStoreClass =
  typeof import('../src/app/lib/AssistantKeyStore').AssistantKeyStore;
type SafeStorageMock = {
  isEncryptionAvailable: jest.Mock;
  encryptString: jest.Mock;
  decryptString: jest.Mock;
};

function withTempHome<T>(fn: (tmpHome: string) => T): T {
  const tmpHome = mkdtempSync(join(tmpdir(), 'mkeditor-keystore-'));
  try {
    return fn(tmpHome);
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
}

function loadKeyStore(tmpHome: string): {
  ks: KeyStoreClass;
  safeStorage: SafeStorageMock;
} {
  jest.resetModules();
  jest.doMock('os', () => ({
    ...jest.requireActual('os'),
    homedir: () => tmpHome,
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../src/app/lib/AssistantKeyStore');
  const ks = mod.AssistantKeyStore as KeyStoreClass;
  ks._resetEncryptionCacheForTests();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as { safeStorage: SafeStorageMock };
  return { ks, safeStorage: electron.safeStorage };
}

describe('AssistantKeyStore.isEncryptionAvailable', () => {
  it('returns true when safeStorage advertises encryption', () => {
    withTempHome((tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      expect(ks.isEncryptionAvailable()).toBe(true);
    });
  });

  it('returns false when safeStorage advertises no encryption', () => {
    withTempHome((tmpHome) => {
      const { ks, safeStorage } = loadKeyStore(tmpHome);
      safeStorage.isEncryptionAvailable.mockReturnValue(false);
      ks._resetEncryptionCacheForTests();
      expect(ks.isEncryptionAvailable()).toBe(false);
    });
  });

  it('returns false (and never throws) when safeStorage throws on probe', () => {
    withTempHome((tmpHome) => {
      const { ks, safeStorage } = loadKeyStore(tmpHome);
      safeStorage.isEncryptionAvailable.mockImplementation(() => {
        throw new Error('not ready');
      });
      ks._resetEncryptionCacheForTests();
      expect(() => ks.isEncryptionAvailable()).not.toThrow();
      expect(ks.isEncryptionAvailable()).toBe(false);
    });
  });
});

describe('AssistantKeyStore.setKey / getKey / hasKey', () => {
  it('round-trips a key through encrypt/decrypt', () => {
    withTempHome((tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      expect(ks.setKey('anthropic', 'sk-ant-secret')).toBe(true);
      expect(ks.hasKey('anthropic')).toBe(true);
      expect(ks.getKey('anthropic')).toBe('sk-ant-secret');
    });
  });

  it('stores the key as base64 ciphertext on disk, never plaintext', () => {
    withTempHome((tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      ks.setKey('openai', 'sk-plaintext-openai');

      const file = normalize(tmpHome + '/.mkeditor/assistant.json');
      const written = readFileSync(file, 'utf-8');
      expect(written).not.toContain('sk-plaintext-openai');
      const parsed = JSON.parse(written) as { keys: { openai?: string } };
      expect(typeof parsed.keys.openai).toBe('string');
      // base64 decodes to "ENC:sk-plaintext-openai" under our mock.
      const decoded = Buffer.from(parsed.keys.openai!, 'base64').toString(
        'utf-8',
      );
      expect(decoded).toBe('ENC:sk-plaintext-openai');
    });
  });

  it('refuses to set a key when encryption is unavailable', () => {
    withTempHome((tmpHome) => {
      const { ks, safeStorage } = loadKeyStore(tmpHome);
      safeStorage.isEncryptionAvailable.mockReturnValue(false);
      ks._resetEncryptionCacheForTests();
      expect(ks.setKey('anthropic', 'sk-ant-x')).toBe(false);
      expect(ks.hasKey('anthropic')).toBe(false);
      expect(ks.getKey('anthropic')).toBeNull();
    });
  });

  it('returns null from getKey when no key is stored', () => {
    withTempHome((tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      expect(ks.getKey('anthropic')).toBeNull();
      expect(ks.hasKey('anthropic')).toBe(false);
    });
  });

  it('returns null from getKey when decryption throws (corrupted ciphertext)', () => {
    withTempHome((tmpHome) => {
      const { ks, safeStorage } = loadKeyStore(tmpHome);
      ks.setKey('anthropic', 'sk-ok');
      safeStorage.decryptString.mockImplementation(() => {
        throw new Error('bad ciphertext');
      });
      expect(() => ks.getKey('anthropic')).not.toThrow();
      expect(ks.getKey('anthropic')).toBeNull();
    });
  });

  it('returns false from setKey when encryption itself throws', () => {
    withTempHome((tmpHome) => {
      const { ks, safeStorage } = loadKeyStore(tmpHome);
      safeStorage.encryptString.mockImplementation(() => {
        throw new Error('keychain locked');
      });
      expect(ks.setKey('openai', 'sk-x')).toBe(false);
      expect(ks.hasKey('openai')).toBe(false);
    });
  });

  it('keeps providers isolated — setting anthropic does not affect openai', () => {
    withTempHome((tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      ks.setKey('anthropic', 'sk-ant');
      expect(ks.hasKey('anthropic')).toBe(true);
      expect(ks.hasKey('openai')).toBe(false);
      expect(ks.getKey('openai')).toBeNull();
    });
  });

  it('replaces an existing key on re-set', () => {
    withTempHome((tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      ks.setKey('anthropic', 'sk-old');
      ks.setKey('anthropic', 'sk-new');
      expect(ks.getKey('anthropic')).toBe('sk-new');
    });
  });
});

describe('AssistantKeyStore.clearKey', () => {
  it('removes a stored key', () => {
    withTempHome((tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      ks.setKey('anthropic', 'sk-x');
      expect(ks.hasKey('anthropic')).toBe(true);

      expect(ks.clearKey('anthropic')).toBe(true);
      expect(ks.hasKey('anthropic')).toBe(false);
      expect(ks.getKey('anthropic')).toBeNull();
    });
  });

  it('is a successful no-op when no key is stored', () => {
    withTempHome((tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      expect(ks.clearKey('openai')).toBe(true);
    });
  });

  it('does not touch the other provider when clearing one', () => {
    withTempHome((tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      ks.setKey('anthropic', 'sk-ant');
      ks.setKey('openai', 'sk-oai');
      ks.clearKey('anthropic');
      expect(ks.hasKey('openai')).toBe(true);
      expect(ks.getKey('openai')).toBe('sk-oai');
    });
  });
});

describe('AssistantKeyStore — file shape & atomic writes', () => {
  it('creates ~/.mkeditor/assistant.json on first setKey', () => {
    withTempHome((tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      ks.setKey('anthropic', 'sk-x');
      expect(existsSync(normalize(tmpHome + '/.mkeditor/assistant.json'))).toBe(
        true,
      );
    });
  });

  it('leaves no tmp file behind after a successful write', () => {
    withTempHome((tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      ks.setKey('anthropic', 'sk-x');
      expect(
        existsSync(normalize(tmpHome + '/.mkeditor/assistant.json.tmp')),
      ).toBe(false);
    });
  });

  it('writes via tmp + rename (fs call order)', () => {
    withTempHome((tmpHome) => {
      const calls: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const realFs = jest.requireActual('fs');
      jest.resetModules();
      jest.doMock('os', () => ({
        ...jest.requireActual('os'),
        homedir: () => tmpHome,
      }));
      jest.doMock('fs', () => ({
        ...realFs,
        writeFileSync: (p: string, d: string | Buffer, o?: unknown) => {
          calls.push(`write:${p}`);
          return realFs.writeFileSync(p, d, o);
        },
        renameSync: (from: string, to: string) => {
          calls.push(`rename:${from}->${to}`);
          return realFs.renameSync(from, to);
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AssistantKeyStore } = require('../src/app/lib/AssistantKeyStore');
      AssistantKeyStore._resetEncryptionCacheForTests();
      AssistantKeyStore.setKey('anthropic', 'sk-x');

      const tmpPath = normalize(tmpHome + '/.mkeditor/assistant.json.tmp');
      const finalPath = normalize(tmpHome + '/.mkeditor/assistant.json');
      expect(calls).toContain(`write:${tmpPath}`);
      expect(calls).toContain(`rename:${tmpPath}->${finalPath}`);
      const writeIdx = calls.indexOf(`write:${tmpPath}`);
      const renameIdx = calls.indexOf(`rename:${tmpPath}->${finalPath}`);
      expect(renameIdx).toBeGreaterThan(writeIdx);
      expect(calls).not.toContain(`write:${finalPath}`);
    });
  });

  it('recovers from a corrupted assistant.json by treating it as empty', () => {
    withTempHome((tmpHome) => {
      const dir = normalize(tmpHome + '/.mkeditor/');
      const file = dir + 'assistant.json';
      const fs = jest.requireActual('fs') as typeof import('fs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, '{ not valid json', 'utf-8');

      const { ks } = loadKeyStore(tmpHome);
      expect(() => ks.getKey('anthropic')).not.toThrow();
      expect(ks.getKey('anthropic')).toBeNull();
      // Subsequent setKey should overwrite the corrupted file cleanly.
      expect(ks.setKey('anthropic', 'sk-fresh')).toBe(true);
      expect(ks.getKey('anthropic')).toBe('sk-fresh');
    });
  });
});
