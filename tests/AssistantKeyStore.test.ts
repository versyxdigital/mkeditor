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
  isAsyncEncryptionAvailable: jest.Mock;
  encryptStringAsync: jest.Mock;
  decryptStringAsync: jest.Mock;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function withTempHome<T>(
  fn: (tmpHome: string) => T | Promise<T>,
): Promise<T> {
  const tmpHome = mkdtempSync(join(tmpdir(), 'mkeditor-keystore-'));
  try {
    return await fn(tmpHome);
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
  it('returns true when safeStorage advertises encryption', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      expect(await ks.isEncryptionAvailable()).toBe(true);
    });
  });

  it('returns false when safeStorage advertises no encryption', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks, safeStorage } = loadKeyStore(tmpHome);
      safeStorage.isAsyncEncryptionAvailable.mockReturnValue(false);
      ks._resetEncryptionCacheForTests();
      expect(await ks.isEncryptionAvailable()).toBe(false);
    });
  });

  it('returns false (and never throws) when safeStorage throws on probe', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks, safeStorage } = loadKeyStore(tmpHome);
      safeStorage.isAsyncEncryptionAvailable.mockImplementation(() => {
        throw new Error('not ready');
      });
      ks._resetEncryptionCacheForTests();
      expect(await ks.isEncryptionAvailable()).toBe(false);
    });
  });
});

describe('AssistantKeyStore.setKey / getKey / hasKey', () => {
  it('round-trips a key through encrypt/decrypt', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      expect(await ks.setKey('anthropic', 'sk-ant-secret')).toBe(true);
      expect(await ks.hasKey('anthropic')).toBe(true);
      expect(await ks.getKey('anthropic')).toBe('sk-ant-secret');
    });
  });

  it('stores the key as base64 ciphertext on disk, never plaintext', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      await ks.setKey('openai', 'sk-plaintext-openai');

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

  it('refuses to set a key when encryption is unavailable', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks, safeStorage } = loadKeyStore(tmpHome);
      safeStorage.isAsyncEncryptionAvailable.mockReturnValue(false);
      ks._resetEncryptionCacheForTests();
      expect(await ks.setKey('anthropic', 'sk-ant-x')).toBe(false);
      expect(await ks.hasKey('anthropic')).toBe(false);
      expect(await ks.getKey('anthropic')).toBeNull();
    });
  });

  it('returns null from getKey when no key is stored', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      expect(await ks.getKey('anthropic')).toBeNull();
      expect(await ks.hasKey('anthropic')).toBe(false);
    });
  });

  it('returns null from getKey when decryption throws (corrupted ciphertext)', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks, safeStorage } = loadKeyStore(tmpHome);
      await ks.setKey('anthropic', 'sk-ok');
      safeStorage.decryptStringAsync.mockImplementation(() => {
        throw new Error('bad ciphertext');
      });
      expect(await ks.getKey('anthropic')).toBeNull();
    });
  });

  it('returns false from setKey when encryption itself throws', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks, safeStorage } = loadKeyStore(tmpHome);
      safeStorage.encryptStringAsync.mockImplementation(() => {
        throw new Error('keychain locked');
      });
      expect(await ks.setKey('openai', 'sk-x')).toBe(false);
      expect(await ks.hasKey('openai')).toBe(false);
    });
  });

  it('keeps providers isolated — setting anthropic does not affect openai', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      await ks.setKey('anthropic', 'sk-ant');
      expect(await ks.hasKey('anthropic')).toBe(true);
      expect(await ks.hasKey('openai')).toBe(false);
      expect(await ks.getKey('openai')).toBeNull();
    });
  });

  it('replaces an existing key on re-set', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      await ks.setKey('anthropic', 'sk-old');
      await ks.setKey('anthropic', 'sk-new');
      expect(await ks.getKey('anthropic')).toBe('sk-new');
    });
  });
});

describe('AssistantKeyStore.clearKey', () => {
  it('removes a stored key', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      await ks.setKey('anthropic', 'sk-x');
      expect(await ks.hasKey('anthropic')).toBe(true);

      expect(await ks.clearKey('anthropic')).toBe(true);
      expect(await ks.hasKey('anthropic')).toBe(false);
      expect(await ks.getKey('anthropic')).toBeNull();
    });
  });

  it('is a successful no-op when no key is stored', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      expect(await ks.clearKey('openai')).toBe(true);
    });
  });

  it('does not touch the other provider when clearing one', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      await ks.setKey('anthropic', 'sk-ant');
      await ks.setKey('openai', 'sk-oai');
      await ks.clearKey('anthropic');
      expect(await ks.hasKey('openai')).toBe(true);
      expect(await ks.getKey('openai')).toBe('sk-oai');
    });
  });
});

describe('AssistantKeyStore — file shape & atomic writes', () => {
  it('creates ~/.mkeditor/assistant.json on first setKey', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      await ks.setKey('anthropic', 'sk-x');
      expect(existsSync(normalize(tmpHome + '/.mkeditor/assistant.json'))).toBe(
        true,
      );
    });
  });

  it('leaves no tmp file behind after a successful write', async () => {
    await withTempHome(async (tmpHome) => {
      const { ks } = loadKeyStore(tmpHome);
      await ks.setKey('anthropic', 'sk-x');
      expect(
        existsSync(normalize(tmpHome + '/.mkeditor/assistant.json.tmp')),
      ).toBe(false);
    });
  });

  it('writes via tmp + rename (fs call order)', async () => {
    await withTempHome(async (tmpHome) => {
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
      await AssistantKeyStore.setKey('anthropic', 'sk-x');

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

  it('recovers from a corrupted assistant.json by treating it as empty', async () => {
    await withTempHome(async (tmpHome) => {
      const dir = normalize(tmpHome + '/.mkeditor/');
      const file = dir + 'assistant.json';
      const fs = jest.requireActual('fs') as typeof import('fs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, '{ not valid json', 'utf-8');

      const { ks } = loadKeyStore(tmpHome);
      expect(await ks.getKey('anthropic')).toBeNull();
      // Subsequent setKey should overwrite the corrupted file cleanly.
      expect(await ks.setKey('anthropic', 'sk-fresh')).toBe(true);
      expect(await ks.getKey('anthropic')).toBe('sk-fresh');
    });
  });
});

describe('AssistantKeyStore — async safeStorage', () => {
  it('uses only async OS APIs and accepts existing encrypted entries', async () => {
    await withTempHome(async (home) => {
      const { ks, safeStorage } = loadKeyStore(home);
      await ks.setKey('anthropic', 'fixture');
      const fs = jest.requireActual('fs') as typeof import('fs');
      const file = join(home, '.mkeditor/assistant.json');
      const store = JSON.parse(fs.readFileSync(file, 'utf8'));
      store.keys.anthropic = Buffer.from('ENC:legacy-key').toString('base64');
      fs.writeFileSync(file, JSON.stringify(store));
      expect(await ks.getKey('anthropic')).toBe('legacy-key');
      await ks.setKey('openai', 'new-key');
      expect(safeStorage.decryptStringAsync).toHaveBeenCalledWith(
        Buffer.from('ENC:legacy-key'),
      );
      expect(safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
      expect(safeStorage.encryptString).not.toHaveBeenCalled();
      expect(safeStorage.decryptString).not.toHaveBeenCalled();
    });
  });
  it('shares pending availability probes and handles async keychain rejections', async () => {
    await withTempHome(async (home) => {
      const { ks, safeStorage } = loadKeyStore(home);
      const gate = deferred<boolean>();
      safeStorage.isAsyncEncryptionAvailable.mockReturnValue(gate.promise);
      const first = ks.isEncryptionAvailable(),
        second = ks.isEncryptionAvailable();
      expect(first).toBe(second);
      gate.resolve(true);
      await Promise.all([first, second]);
      expect(safeStorage.isAsyncEncryptionAvailable).toHaveBeenCalledTimes(1);
      safeStorage.encryptStringAsync.mockRejectedValueOnce(new Error('locked'));
      expect(await ks.setKey('openai', 'key')).toBe(false);
      await ks.setKey('openai', 'key');
      safeStorage.decryptStringAsync.mockRejectedValueOnce(new Error('locked'));
      expect(await ks.getKey('openai')).toBeNull();
      ks._resetEncryptionCacheForTests();
      safeStorage.isAsyncEncryptionAvailable.mockRejectedValueOnce(
        new Error('not ready'),
      );
      expect(await ks.isEncryptionAvailable()).toBe(false);
    });
  });
  it('does not resurrect a key cleared while encryption is pending', async () => {
    await withTempHome(async (home) => {
      const { ks, safeStorage } = loadKeyStore(home);
      const entered = deferred<void>(),
        encrypted = deferred<Buffer>();
      safeStorage.encryptStringAsync.mockImplementationOnce(() => {
        entered.resolve();
        return encrypted.promise;
      });
      const set = ks.setKey('anthropic', 'key');
      await entered.promise;
      const clear = ks.clearKey('anthropic');
      encrypted.resolve(Buffer.from('ENC:key'));
      expect(await set).toBe(true);
      expect(await clear).toBe(true);
      expect(await ks.hasKey('anthropic')).toBe(false);
    });
  });
  it('preserves another provider and config updates made during encryption', async () => {
    await withTempHome(async (home) => {
      const { ks, safeStorage } = loadKeyStore(home);
      const entered = deferred<void>(),
        encrypted = deferred<Buffer>();
      safeStorage.encryptStringAsync.mockImplementationOnce(() => {
        entered.resolve();
        return encrypted.promise;
      });
      const set = ks.setKey('anthropic', 'key-a');
      await entered.promise;
      await ks.setKey('openai', 'key-b');
      const { AssistantConfig } = jest.requireActual(
        '../src/app/lib/AssistantConfig',
      );
      AssistantConfig.update({ provider: 'openai', config: { enabled: true } });
      encrypted.resolve(Buffer.from('ENC:key-a'));
      await set;
      expect(await ks.getKey('openai')).toBe('key-b');
      expect(await ks.getKey('anthropic')).toBe('key-a');
      const saved = JSON.parse(
        readFileSync(join(home, '.mkeditor/assistant.json'), 'utf8'),
      );
      expect(saved.providers.openai.enabled).toBe(true);
    });
  });
  it('ignores decryption that completes after the user removes the key', async () => {
    await withTempHome(async (home) => {
      const { ks, safeStorage } = loadKeyStore(home);
      await ks.setKey('anthropic', 'key');
      const entered = deferred<void>(),
        decrypted = deferred<{ result: string; shouldReEncrypt: boolean }>();
      safeStorage.decryptStringAsync.mockImplementationOnce(() => {
        entered.resolve();
        return decrypted.promise;
      });
      const read = ks.getKey('anthropic');
      await entered.promise;
      await ks.clearKey('anthropic');
      decrypted.resolve({ result: 'key', shouldReEncrypt: false });
      expect(await read).toBeNull();
      expect(await ks.hasKey('anthropic')).toBe(false);
    });
  });
  it('refreshes ciphertext when requested without losing a usable key on refresh failure', async () => {
    await withTempHome(async (home) => {
      const { ks, safeStorage } = loadKeyStore(home);
      await ks.setKey('anthropic', 'key');
      safeStorage.decryptStringAsync.mockResolvedValue({
        result: 'key',
        shouldReEncrypt: true,
      });
      safeStorage.encryptStringAsync.mockRejectedValueOnce(new Error('locked'));
      expect(await ks.getKey('anthropic')).toBe('key');
      safeStorage.encryptStringAsync.mockResolvedValueOnce(
        Buffer.from('rotated-ciphertext'),
      );
      expect(await ks.getKey('anthropic')).toBe('key');
      const saved = JSON.parse(
        readFileSync(join(home, '.mkeditor/assistant.json'), 'utf8'),
      );
      expect(saved.keys.anthropic).toBe(
        Buffer.from('rotated-ciphertext').toString('base64'),
      );
    });
  });
});
