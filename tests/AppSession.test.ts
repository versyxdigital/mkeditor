/**
 * AppSession unit tests.
 *
 * We point AppSession at a temporary directory by stubbing `os.homedir`
 * before requiring the module, since the class freezes its paths at
 * module load. Each test gets a fresh tmp dir and reloads the module
 * via `jest.isolateModules` so the static paths re-resolve.
 *
 * `fs` is mocked module-wide for tests that need to assert call order
 * or simulate failures (destructured imports otherwise capture the
 * binding at module load, so post-load `jest.spyOn(fs, ...)` is a
 * no-op against AppSession's own calls).
 */

import { mkdtempSync, rmSync, existsSync, readFileSync, lstatSync } from 'fs';
import { tmpdir } from 'os';
import { join, normalize } from 'path';
import type { SessionPayload } from '../src/app/interfaces/Session';

const validPayload: SessionPayload = {
  version: 1,
  activeFile: '/abs/path/foo.md',
  workspaceRoot: null,
  tabs: [
    {
      path: '/abs/path/foo.md',
      name: 'foo.md',
      viewState: { cursorState: [] },
    },
    {
      path: 'untitled-1',
      name: 'Untitled 1',
      viewState: null,
      untitledContent: 'scratch',
    },
  ],
};

function withTempHome<T>(fn: (tmpHome: string) => T): T {
  const tmpHome = mkdtempSync(join(tmpdir(), 'mkeditor-session-'));
  try {
    return fn(tmpHome);
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
}

function loadAppSession(tmpHome: string) {
  jest.resetModules();
  jest.doMock('os', () => ({
    ...jest.requireActual('os'),
    homedir: () => tmpHome,
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../src/app/lib/AppSession');
  return mod.AppSession as typeof import('../src/app/lib/AppSession').AppSession;
}

describe('AppSession.load', () => {
  it('returns null when the session file is missing', () => {
    withTempHome((tmpHome) => {
      const AppSession = loadAppSession(tmpHome);
      expect(AppSession.load()).toBeNull();
    });
  });

  it('returns the parsed payload when the file is valid', () => {
    withTempHome((tmpHome) => {
      const dir = normalize(tmpHome + '/.mkeditor/');
      const file = dir + 'session.json';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(validPayload), 'utf-8');

      const AppSession = loadAppSession(tmpHome);
      expect(AppSession.load()).toEqual(validPayload);
    });
  });

  it('returns null on corrupted JSON without throwing', () => {
    withTempHome((tmpHome) => {
      const dir = normalize(tmpHome + '/.mkeditor/');
      const file = dir + 'session.json';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, '{ not valid json', 'utf-8');

      const AppSession = loadAppSession(tmpHome);
      expect(() => AppSession.load()).not.toThrow();
      expect(AppSession.load()).toBeNull();
    });
  });

  it('returns null when the schema version mismatches', () => {
    withTempHome((tmpHome) => {
      const dir = normalize(tmpHome + '/.mkeditor/');
      const file = dir + 'session.json';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({ ...validPayload, version: 999 }),
        'utf-8',
      );

      const AppSession = loadAppSession(tmpHome);
      expect(AppSession.load()).toBeNull();
    });
  });

  it('returns null when the shape is wrong (missing tabs array)', () => {
    withTempHome((tmpHome) => {
      const dir = normalize(tmpHome + '/.mkeditor/');
      const file = dir + 'session.json';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({ version: 1, activeFile: null }),
        'utf-8',
      );

      const AppSession = loadAppSession(tmpHome);
      expect(AppSession.load()).toBeNull();
    });
  });
});

describe('AppSession.save', () => {
  it('creates the config directory if missing', () => {
    withTempHome((tmpHome) => {
      const AppSession = loadAppSession(tmpHome);
      AppSession.save(validPayload);
      expect(existsSync(normalize(tmpHome + '/.mkeditor/'))).toBe(true);
      expect(existsSync(normalize(tmpHome + '/.mkeditor/session.json'))).toBe(
        true,
      );
    });
  });

  it('round-trips a payload through load()', () => {
    withTempHome((tmpHome) => {
      const AppSession = loadAppSession(tmpHome);
      AppSession.save(validPayload);
      expect(AppSession.load()).toEqual(validPayload);
    });
  });

  it('leaves no tmp file behind after a successful save', () => {
    withTempHome((tmpHome) => {
      const AppSession = loadAppSession(tmpHome);
      AppSession.save(validPayload);
      const tmpPath = normalize(tmpHome + '/.mkeditor/session.json.tmp');
      expect(existsSync(tmpPath)).toBe(false);
    });
  });

  it('replaces a pre-existing session.json atomically (rename swaps the inode)', () => {
    withTempHome((tmpHome) => {
      if (process.platform === 'win32') return; // inode semantics differ on NTFS
      const dir = normalize(tmpHome + '/.mkeditor/');
      const finalPath = dir + 'session.json';
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        finalPath,
        JSON.stringify({ version: 1, tabs: [], activeFile: null }),
        'utf-8',
      );
      const beforeIno = lstatSync(finalPath).ino;

      const AppSession = loadAppSession(tmpHome);
      AppSession.save(validPayload);

      // rename replaces the directory entry with the tmp file's inode.
      const afterIno = lstatSync(finalPath).ino;
      expect(afterIno).not.toBe(beforeIno);
      expect(
        JSON.parse(readFileSync(finalPath, { encoding: 'utf-8' })),
      ).toEqual(validPayload);
    });
  });

  it('writes to tmp then renames into place (fs call order)', () => {
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
        writeFileSync: (
          path: string,
          data: string | Buffer,
          opts?: unknown,
        ) => {
          calls.push(`write:${path}`);
          return realFs.writeFileSync(path, data, opts);
        },
        renameSync: (from: string, to: string) => {
          calls.push(`rename:${from}->${to}`);
          return realFs.renameSync(from, to);
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AppSession } = require('../src/app/lib/AppSession');
      AppSession.save(validPayload);

      const tmpPath = normalize(tmpHome + '/.mkeditor/session.json.tmp');
      const finalPath = normalize(tmpHome + '/.mkeditor/session.json');
      expect(calls).toContain(`write:${tmpPath}`);
      expect(calls).toContain(`rename:${tmpPath}->${finalPath}`);
      // Tmp is written before the rename.
      const writeIdx = calls.indexOf(`write:${tmpPath}`);
      const renameIdx = calls.indexOf(`rename:${tmpPath}->${finalPath}`);
      expect(renameIdx).toBeGreaterThan(writeIdx);
      // No direct write to the canonical path.
      expect(calls).not.toContain(`write:${finalPath}`);
    });
  });

  it('stamps the current schema version on every write', () => {
    withTempHome((tmpHome) => {
      const AppSession = loadAppSession(tmpHome);
      // Forced bogus version on input — save() should normalise to 1.
      AppSession.save({
        ...validPayload,
        version: 999,
      } as unknown as SessionPayload);

      const file = normalize(tmpHome + '/.mkeditor/session.json');
      const written = JSON.parse(readFileSync(file, { encoding: 'utf-8' }));
      expect(written.version).toBe(1);
    });
  });

  it('does not throw on write failure', () => {
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
      const { AppSession } = require('../src/app/lib/AppSession');
      expect(() => AppSession.save(validPayload)).not.toThrow();
    });
  });
});

describe('AppSession.buildRestoreEnvelope', () => {
  it('returns an empty envelope when given null', () => {
    withTempHome((tmpHome) => {
      const AppSession = loadAppSession(tmpHome);
      expect(AppSession.buildRestoreEnvelope(null)).toEqual({
        session: null,
        missing: [],
        contents: {},
      });
    });
  });

  it('drops missing real-file tabs from the envelope and lists them under `missing`', () => {
    withTempHome((tmpHome) => {
      // requireActual sidesteps any lingering jest.doMock('fs', ...)
      // installed by earlier tests in the file.
      const fs = jest.requireActual('fs') as typeof import('fs');
      const realFile = normalize(tmpHome + '/exists.md');
      fs.writeFileSync(realFile, 'real body', 'utf-8');
      const missingFile = normalize(tmpHome + '/gone.md');

      const AppSession = loadAppSession(tmpHome);
      const envelope = AppSession.buildRestoreEnvelope({
        version: 1,
        activeFile: missingFile,
        workspaceRoot: null,
        tabs: [
          { path: realFile, name: 'exists.md', viewState: null },
          { path: missingFile, name: 'gone.md', viewState: null },
        ],
      });

      expect(envelope.missing).toEqual([missingFile]);
      expect(envelope.session?.tabs.map((t) => t.path)).toEqual([realFile]);
      expect(envelope.contents).toEqual({ [realFile]: 'real body' });
    });
  });

  it('preserves untitled tabs unconditionally', () => {
    withTempHome((tmpHome) => {
      const AppSession = loadAppSession(tmpHome);
      const envelope = AppSession.buildRestoreEnvelope({
        version: 1,
        activeFile: 'untitled-1',
        workspaceRoot: null,
        tabs: [
          {
            path: 'untitled-1',
            name: 'Untitled 1',
            viewState: null,
            untitledContent: 'scratch',
          },
        ],
      });

      expect(envelope.missing).toEqual([]);
      expect(envelope.session?.tabs).toHaveLength(1);
      expect(envelope.session?.tabs[0].path).toBe('untitled-1');
      expect(envelope.contents).toEqual({});
    });
  });

  it('nulls activeFile when the persisted active path is missing', () => {
    withTempHome((tmpHome) => {
      const fs = jest.requireActual('fs') as typeof import('fs');
      const keep = normalize(tmpHome + '/keep.md');
      fs.writeFileSync(keep, 'kept', 'utf-8');
      const gone = normalize(tmpHome + '/gone.md');

      const AppSession = loadAppSession(tmpHome);
      const envelope = AppSession.buildRestoreEnvelope({
        version: 1,
        activeFile: gone,
        workspaceRoot: null,
        tabs: [
          { path: keep, name: 'keep.md', viewState: null },
          { path: gone, name: 'gone.md', viewState: null },
        ],
      });

      expect(envelope.session?.activeFile).toBeNull();
    });
  });

  it('keeps workspaceRoot when the directory still exists', () => {
    withTempHome((tmpHome) => {
      const fs = jest.requireActual('fs') as typeof import('fs');
      const wsDir = normalize(tmpHome + '/my-notes');
      fs.mkdirSync(wsDir);

      const AppSession = loadAppSession(tmpHome);
      const envelope = AppSession.buildRestoreEnvelope({
        version: 1,
        activeFile: null,
        workspaceRoot: wsDir,
        tabs: [],
      });

      expect(envelope.session?.workspaceRoot).toBe(wsDir);
    });
  });

  it('nulls workspaceRoot when the directory is gone', () => {
    withTempHome((tmpHome) => {
      const AppSession = loadAppSession(tmpHome);
      const envelope = AppSession.buildRestoreEnvelope({
        version: 1,
        activeFile: null,
        workspaceRoot: normalize(tmpHome + '/never-existed'),
        tabs: [],
      });

      expect(envelope.session?.workspaceRoot).toBeNull();
    });
  });

  it('treats unreadable files as missing', () => {
    withTempHome((tmpHome) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const realFs = jest.requireActual('fs');
      const present = normalize(tmpHome + '/present.md');
      realFs.writeFileSync(present, 'ok', 'utf-8');

      jest.resetModules();
      jest.doMock('os', () => ({
        ...jest.requireActual('os'),
        homedir: () => tmpHome,
      }));
      jest.doMock('fs', () => ({
        ...realFs,
        readFileSync: () => {
          throw new Error('EACCES');
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { AppSession } = require('../src/app/lib/AppSession');
      const envelope = AppSession.buildRestoreEnvelope({
        version: 1,
        activeFile: present,
        workspaceRoot: null,
        tabs: [{ path: present, name: 'present.md', viewState: null }],
      });

      expect(envelope.missing).toEqual([present]);
      expect(envelope.session?.tabs).toEqual([]);
    });
  });
});
