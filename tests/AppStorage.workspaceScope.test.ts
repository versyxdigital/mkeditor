/**
 * `AppStorage.assertInWorkspace` — security-critical scoping for the
 * `mked:fs:*` IPC handlers.
 *
 * These handlers accept renderer-supplied paths and perform direct
 * fs operations, so the trust boundary lives in
 * `assertInWorkspace`. Directory links use real temp directories and
 * Windows junctions. File-link metadata is injected in two focused cases
 * so those checks also run without Windows symlink privileges.
 */

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  promises as fs,
  realpathSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { AppStorage } from '../src/app/lib/AppStorage';
import { createDirectoryLink } from './utils/directoryLink';

function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'mkeditor-scope-'));
  return fn(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

describe('AppStorage.assertInWorkspace', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    AppStorage.setWorkspaceRoot(null);
  });

  it('rejects every call when no workspace is open', async () => {
    AppStorage.setWorkspaceRoot(null);
    await expect(
      AppStorage.assertInWorkspace('/anything/at/all.md'),
    ).rejects.toThrow(/No workspace is open/);
  });

  it.each(['', null, 42, {}])('rejects an invalid path: %p', async (path) => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      await expect(
        AppStorage.assertInWorkspace(path as unknown as string),
      ).rejects.toThrow(/Invalid path/);
    });
  });

  it('accepts a path inside the workspace and returns the canonical absolute', async () => {
    await withTempRoot(async (root) => {
      const file = join(root, 'notes.md');
      writeFileSync(file, 'hi');
      AppStorage.setWorkspaceRoot(root);
      const safe = await AppStorage.assertInWorkspace(file);
      expect(safe).toBe(await fs.realpath(file));
    });
  });

  it('rejects a path outside the workspace (parent-traversal via `..`)', async () => {
    await withTempRoot(async (parent) => {
      const root = join(parent, 'workspace');
      mkdirSync(root);
      AppStorage.setWorkspaceRoot(root);
      // The sibling is outside the workspace but inside this private fixture.
      const escapeTarget = join(root, '..', 'escape.md');
      writeFileSync(escapeTarget, 'leaked');
      await expect(AppStorage.assertInWorkspace(escapeTarget)).rejects.toThrow(
        /outside the workspace/,
      );
    });
  });

  it('rejects an absolute path that is not under the workspace root', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      // A second tmpdir — clearly not under `root`.
      await withTempRoot(async (otherRoot) => {
        const stray = join(otherRoot, 'stray.md');
        writeFileSync(stray, 'stray');
        await expect(AppStorage.assertInWorkspace(stray)).rejects.toThrow(
          /outside the workspace/,
        );
      });
    });
  });

  it('rejects a file reached through an external directory link (no link laundering)', async () => {
    // Real-fs symlink test — the canonicalisation step is the only
    // thing keeping a malicious / careless symlink from leaking
    // arbitrary files outside the workspace.
    await withTempRoot(async (root) => {
      await withTempRoot(async (otherRoot) => {
        const secret = join(otherRoot, 'secret.md');
        writeFileSync(secret, 'top-secret');
        const directoryLink = join(root, 'linked');
        createDirectoryLink(otherRoot, directoryLink);
        const link = join(directoryLink, 'secret.md');
        expect(await fs.realpath(link)).toBe(realpathSync.native(secret));
        AppStorage.setWorkspaceRoot(root);
        await expect(AppStorage.assertInWorkspace(link)).rejects.toThrow(
          /outside the workspace/,
        );
      });
    });
  });

  it('mustExist: false — accepts a not-yet-existing target inside the workspace (write/create path)', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      const target = join(root, 'new-subdir', 'fresh.md');
      // Missing parents must still be resolved against the canonical root.
      const safe = await AppStorage.assertInWorkspace(target, {
        mustExist: false,
      });
      expect(safe).toBe(
        join(await fs.realpath(root), 'new-subdir', 'fresh.md'),
      );
    });
  });

  it('mustExist: false — still rejects an escape attempt', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      const escape = join(root, '..', 'never-exists.md');
      await expect(
        AppStorage.assertInWorkspace(escape, { mustExist: false }),
      ).rejects.toThrow(/outside the workspace/);
    });
  });

  it('mustExist: false rejects external file-link metadata without requiring link privileges', async () => {
    await withTempRoot(async (root) => {
      await withTempRoot(async (outside) => {
        const secret = join(outside, 'secret.md');
        writeFileSync(secret, 'do not overwrite');
        const link = join(root, 'shortcut.md');
        const canonicalSecret = await fs.realpath(secret);
        const realpath = jest
          .spyOn(fs, 'realpath')
          .mockResolvedValueOnce(canonicalSecret);
        AppStorage.setWorkspaceRoot(root);
        await expect(
          AppStorage.assertInWorkspace(link, { mustExist: false }),
        ).rejects.toThrow(/outside the workspace/);
        expect(realpath).toHaveBeenCalledWith(link);
        expect(await fs.readFile(secret, 'utf8')).toBe('do not overwrite');
      });
    });
  });

  it('mustExist: false resolves ancestors above missing parent directories', async () => {
    await withTempRoot(async (root) => {
      await withTempRoot(async (outside) => {
        const link = join(root, 'shortcut');
        createDirectoryLink(outside, link);
        AppStorage.setWorkspaceRoot(root);
        await expect(
          AppStorage.assertInWorkspace(
            join(link, 'missing', 'nested', 'note.md'),
            {
              mustExist: false,
            },
          ),
        ).rejects.toThrow(/outside the workspace/);
      });
    });
  });

  it('mustExist: false refuses dangling symlinks instead of treating them as missing', async () => {
    await withTempRoot(async (root) => {
      const link = join(root, 'dangling.md');
      const linkMetadata = Object.assign(await fs.lstat(root), {
        isSymbolicLink: () => true,
      });
      const missingTarget = Object.assign(new Error('Dangling file link'), {
        code: 'ENOENT',
      });
      const realpath = jest
        .spyOn(fs, 'realpath')
        .mockRejectedValueOnce(missingTarget);
      const lstat = jest.spyOn(fs, 'lstat').mockResolvedValueOnce(linkMetadata);
      AppStorage.setWorkspaceRoot(root);
      await expect(
        AppStorage.assertInWorkspace(link, { mustExist: false }),
      ).rejects.toThrow(/symbolic link/);
      expect(realpath).toHaveBeenCalledWith(link);
      expect(lstat).toHaveBeenCalledWith(link);
    });
  });

  it('mustExist: true — surfaces ENOENT as a clear "file not found"', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      await expect(
        AppStorage.assertInWorkspace(join(root, 'no-such.md')),
      ).rejects.toThrow(/File not found/);
    });
  });

  it('accepts files when the workspace root itself is a symlink', async () => {
    // Real-world repro: user opens `~/projects` which is a symlink to
    // `/mnt/data/projects`. Without realpath'ing the root, every
    // in-workspace file is reported as "outside" because
    // `relative(symlinkPath, realTargetPath)` walks back out of the
    // symlink.
    await withTempRoot(async (realRoot) => {
      const file = join(realRoot, 'inside.md');
      writeFileSync(file, 'hi');

      const linkRoot = join(
        mkdtempSync(join(tmpdir(), 'mkeditor-link-')),
        'workspace-link',
      );
      createDirectoryLink(realRoot, linkRoot);
      try {
        AppStorage.setWorkspaceRoot(linkRoot);
        const safe = await AppStorage.assertInWorkspace(file);
        expect(safe).toBe(await fs.realpath(file));
      } finally {
        rmSync(linkRoot, { force: true });
        rmSync(dirname(linkRoot), { recursive: true, force: true });
      }
    });
  });

  it('accepts an in-workspace directory whose name begins with `..`', async () => {
    // `relative()` returns `..config/file.md` for this case — a bare
    // `startsWith('..')` check would mistake it for parent-traversal
    // and falsely reject the path.
    await withTempRoot(async (root) => {
      const dir = join(root, '..config');
      mkdirSync(dir);
      const file = join(dir, 'note.md');
      writeFileSync(file, 'hi');
      AppStorage.setWorkspaceRoot(root);
      const safe = await AppStorage.assertInWorkspace(file);
      expect(safe).toBe(await fs.realpath(file));
    });
  });

  it('still rejects `..` and `../something` even with the looser prefix check', async () => {
    // Regression guard: tightening from `startsWith('..')` to
    // `=== '..' || startsWith('..' + sep)` must not let real parent-
    // traversal slip through.
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      // Lexical `..` resolves to the workspace's parent.
      await expect(
        AppStorage.assertInWorkspace(join(root, '..'), { mustExist: false }),
      ).rejects.toThrow(/outside the workspace/);
    });
  });
});
