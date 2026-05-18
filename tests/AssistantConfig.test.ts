/**
 * AssistantConfig + assistantStoreFile unit tests.
 *
 * Together these two modules own the on-disk `~/.mkeditor/assistant.json`
 * for non-secret provider config. `AssistantKeyStore.test.ts` exercises
 * the `keys` section; this file exercises the `providers` section plus
 * the shared helper's atomic-write + schema-fallback paths.
 *
 * Same `withTempHome` / `jest.doMock('os', ...)` pattern as the keystore
 * tests so static paths re-resolve under the temp dir on each test.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, normalize } from 'path';

type ConfigClass =
  typeof import('../src/app/lib/AssistantConfig').AssistantConfig;

function withTempHome<T>(fn: (tmpHome: string) => T): T {
  const tmpHome = mkdtempSync(join(tmpdir(), 'mkeditor-config-'));
  try {
    return fn(tmpHome);
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
}

function loadAssistantConfig(tmpHome: string): ConfigClass {
  jest.resetModules();
  // Revert any per-test `jest.doMock('fs', ...)` from a prior test in
  // this file — `resetModules` only clears the require cache, not the
  // mock registry. Without this, the failing-write test's fs mock
  // leaks into the next test in the suite.
  jest.unmock('fs');
  jest.doMock('os', () => ({
    ...jest.requireActual('os'),
    homedir: () => tmpHome,
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../src/app/lib/AssistantConfig');
  return mod.AssistantConfig as ConfigClass;
}

const fileFor = (tmpHome: string) =>
  normalize(tmpHome + '/.mkeditor/assistant.json');
const tmpFor = (tmpHome: string) => fileFor(tmpHome) + '.tmp';

describe('AssistantConfig.load', () => {
  it('returns DEFAULT_PROVIDER_CONFIG when no file exists', () => {
    withTempHome((tmpHome) => {
      const cfg = loadAssistantConfig(tmpHome).load();
      expect(cfg.anthropic.enabled).toBe(false);
      expect(cfg.openai.enabled).toBe(false);
      expect(cfg.ollama.enabled).toBe(false);
      expect(cfg.ollama.baseUrl).toBe('http://localhost:11434');
    });
  });

  it('returns defaults when the file is malformed JSON (no throw)', () => {
    withTempHome((tmpHome) => {
      const dir = normalize(tmpHome + '/.mkeditor/');
      const fs = jest.requireActual('fs') as typeof import('fs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fileFor(tmpHome), '{ not valid', 'utf-8');

      const Config = loadAssistantConfig(tmpHome);
      expect(() => Config.load()).not.toThrow();
      const cfg = Config.load();
      expect(cfg.anthropic.enabled).toBe(false);
    });
  });

  it('returns defaults when the on-disk schema version mismatches', () => {
    withTempHome((tmpHome) => {
      const dir = normalize(tmpHome + '/.mkeditor/');
      const fs = jest.requireActual('fs') as typeof import('fs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        fileFor(tmpHome),
        JSON.stringify({
          version: 999,
          providers: { anthropic: { enabled: true } },
          keys: {},
        }),
        'utf-8',
      );

      const Config = loadAssistantConfig(tmpHome);
      const cfg = Config.load();
      // Version mismatch falls back to defaults — enabled stays false.
      expect(cfg.anthropic.enabled).toBe(false);
    });
  });

  it('returns defaults when a top-level provider slot is missing', () => {
    withTempHome((tmpHome) => {
      const dir = normalize(tmpHome + '/.mkeditor/');
      const fs = jest.requireActual('fs') as typeof import('fs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        fileFor(tmpHome),
        JSON.stringify({
          version: 1,
          // ollama missing — should fail schema check
          providers: { anthropic: { enabled: true }, openai: { enabled: false } },
          keys: {},
        }),
        'utf-8',
      );

      const Config = loadAssistantConfig(tmpHome);
      const cfg = Config.load();
      // Whole shape rejected → defaults across the board.
      expect(cfg.anthropic.enabled).toBe(false);
    });
  });

  it('backfills missing fields within a provider slot from defaults', () => {
    withTempHome((tmpHome) => {
      const dir = normalize(tmpHome + '/.mkeditor/');
      const fs = jest.requireActual('fs') as typeof import('fs');
      fs.mkdirSync(dir, { recursive: true });
      // Valid top-level shape but anthropic missing defaultModel.
      fs.writeFileSync(
        fileFor(tmpHome),
        JSON.stringify({
          version: 1,
          providers: {
            anthropic: { enabled: true },
            openai: { enabled: false, defaultModel: 'gpt-4o' },
            ollama: {
              enabled: false,
              baseUrl: 'http://localhost:11434',
              defaultModel: 'llama3.2',
            },
          },
          keys: {},
        }),
        'utf-8',
      );

      const Config = loadAssistantConfig(tmpHome);
      const cfg = Config.load();
      expect(cfg.anthropic.enabled).toBe(true);
      // Backfilled from default — model is non-empty without throwing.
      expect(typeof cfg.anthropic.defaultModel).toBe('string');
      expect(cfg.anthropic.defaultModel.length).toBeGreaterThan(0);
    });
  });
});

describe('AssistantConfig.update', () => {
  it('merges a partial patch into the named provider only', () => {
    withTempHome((tmpHome) => {
      const Config = loadAssistantConfig(tmpHome);
      const merged = Config.update({
        provider: 'anthropic',
        config: { enabled: true, defaultModel: 'claude-opus-4-7' },
      });
      expect(merged?.anthropic.enabled).toBe(true);
      expect(merged?.anthropic.defaultModel).toBe('claude-opus-4-7');
      // Other providers untouched.
      expect(merged?.openai.enabled).toBe(false);
      expect(merged?.ollama.baseUrl).toBe('http://localhost:11434');
    });
  });

  it('ignores undefined fields in the patch (leaves the prior value intact)', () => {
    withTempHome((tmpHome) => {
      const Config = loadAssistantConfig(tmpHome);
      Config.update({
        provider: 'openai',
        config: { enabled: true, defaultModel: 'gpt-5' },
      });
      Config.update({
        provider: 'openai',
        config: { enabled: false, defaultModel: undefined },
      });
      const cfg = Config.load();
      expect(cfg.openai.enabled).toBe(false);
      expect(cfg.openai.defaultModel).toBe('gpt-5');
    });
  });

  it('persists changes — load() after update() reads the new value', () => {
    withTempHome((tmpHome) => {
      const Config = loadAssistantConfig(tmpHome);
      Config.update({
        provider: 'ollama',
        config: { baseUrl: 'http://10.0.0.5:11434' },
      });
      const cfg = Config.load();
      expect(cfg.ollama.baseUrl).toBe('http://10.0.0.5:11434');
    });
  });
});

describe('AssistantConfig — atomic writes', () => {
  it('writes via tmp + rename (fs call order, no direct write to canonical file)', () => {
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
      const { AssistantConfig } = require('../src/app/lib/AssistantConfig');
      AssistantConfig.update({
        provider: 'anthropic',
        config: { enabled: true },
      });

      const tmp = tmpFor(tmpHome);
      const final = fileFor(tmpHome);
      expect(calls).toContain(`write:${tmp}`);
      expect(calls).toContain(`rename:${tmp}->${final}`);
      // No direct write to the canonical file — tmp + rename is the
      // only path that touches it.
      expect(calls).not.toContain(`write:${final}`);
      const writeIdx = calls.indexOf(`write:${tmp}`);
      const renameIdx = calls.indexOf(`rename:${tmp}->${final}`);
      expect(renameIdx).toBeGreaterThan(writeIdx);
    });
  });

  it('leaves no tmp behind after a successful update', () => {
    withTempHome((tmpHome) => {
      const Config = loadAssistantConfig(tmpHome);
      Config.update({ provider: 'anthropic', config: { enabled: true } });
      expect(existsSync(tmpFor(tmpHome))).toBe(false);
      expect(existsSync(fileFor(tmpHome))).toBe(true);
    });
  });

  it('stamps the current schema version on every write', () => {
    withTempHome((tmpHome) => {
      const Config = loadAssistantConfig(tmpHome);
      Config.update({ provider: 'anthropic', config: { enabled: true } });
      const written = JSON.parse(readFileSync(fileFor(tmpHome), 'utf-8')) as {
        version: number;
      };
      expect(written.version).toBe(1);
    });
  });

  it('returns null from update() when the disk write fails (no throw)', () => {
    withTempHome((tmpHome) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const realFs = jest.requireActual('fs');
      jest.resetModules();
      jest.doMock('os', () => ({
        ...jest.requireActual('os'),
        homedir: () => tmpHome,
      }));
      jest.doMock('fs', () => ({
        ...realFs,
        writeFileSync: () => {
          throw new Error('EACCES');
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AssistantConfig } = require('../src/app/lib/AssistantConfig');
      const result = AssistantConfig.update({
        provider: 'anthropic',
        config: { enabled: true },
      });
      expect(result).toBeNull();
    });
  });
});

describe('AssistantConfig — schema field name', () => {
  it('writes the disk file with a top-level `providers` field (not `config`)', () => {
    withTempHome((tmpHome) => {
      const Config = loadAssistantConfig(tmpHome);
      Config.update({ provider: 'anthropic', config: { enabled: true } });
      const written = JSON.parse(readFileSync(fileFor(tmpHome), 'utf-8')) as {
        providers?: unknown;
        config?: unknown;
      };
      expect(written.providers).toBeDefined();
      expect(written.config).toBeUndefined();
    });
  });
});
