/**
 * `AppStorage.assertInWorkspace` — security-critical scoping for the
 * `mked:fs:*` IPC handlers.
 *
 * These handlers accept renderer-supplied paths and perform direct
 * fs operations, so the trust boundary lives in
 * `assertInWorkspace`. Tests use real tmpdirs (no fs mocking) so
 * the symlink branch is exercised against the actual OS behaviour.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { AppStorage } from '../src/app/lib/AppStorage';

function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'mkeditor-scope-'));
  return fn(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

describe('AppStorage.assertInWorkspace', () => {
  afterEach(() => {
    AppStorage.setWorkspaceRoot(null);
  });

  it('rejects every call when no workspace is open', async () => {
    AppStorage.setWorkspaceRoot(null);
    await expect(
      AppStorage.assertInWorkspace('/anything/at/all.md'),
    ).rejects.toThrow(/No workspace is open/);
  });

  it('rejects an empty / non-string path', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      await expect(AppStorage.assertInWorkspace('')).rejects.toThrow(
        /Invalid path/,
      );
    });
  });

  it('accepts a path inside the workspace and returns the canonical absolute', async () => {
    await withTempRoot(async (root) => {
      const file = join(root, 'notes.md');
      writeFileSync(file, 'hi');
      AppStorage.setWorkspaceRoot(root);
      const safe = await AppStorage.assertInWorkspace(file);
      // The returned path is realpath-canonicalised — on platforms
      // where the tmpdir root is itself a symlink (macOS
      // /var → /private/var) both sides resolve so we compare
      // suffixes rather than equality.
      expect(safe.endsWith('notes.md')).toBe(true);
    });
  });

  it('rejects a path outside the workspace (parent-traversal via `..`)', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      // ../escape would land in the tmpdir parent — outside the
      // workspace boundary.
      const escapeTarget = join(root, '..', 'escape.md');
      writeFileSync(escapeTarget, 'leaked');
      try {
        await expect(
          AppStorage.assertInWorkspace(escapeTarget),
        ).rejects.toThrow(/outside the workspace/);
      } finally {
        rmSync(escapeTarget, { force: true });
      }
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

  it('rejects a symlink whose target escapes the workspace (no symlink-laundering)', async () => {
    // Real-fs symlink test — the canonicalisation step is the only
    // thing keeping a malicious / careless symlink from leaking
    // arbitrary files outside the workspace.
    await withTempRoot(async (root) => {
      await withTempRoot(async (otherRoot) => {
        const secret = join(otherRoot, 'secret.md');
        writeFileSync(secret, 'top-secret');
        const link = join(root, 'innocent.md');
        try {
          symlinkSync(secret, link);
        } catch (err) {
          // Some CI / Windows configs deny symlink creation
          // without admin — skip if we can't even set up the
          // adversarial scenario.
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'EPERM' || code === 'EACCES') return;
          throw err;
        }
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
      // Parent doesn't exist either — assertInWorkspace falls back
      // to lexical scope check when realpath(parent) ENOENTs. The
      // handler's mkdir -p creates the chain.
      const safe = await AppStorage.assertInWorkspace(target, {
        mustExist: false,
      });
      expect(safe.endsWith(join('new-subdir', 'fresh.md'))).toBe(true);
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
      try {
        symlinkSync(realRoot, linkRoot, 'dir');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EPERM' || code === 'EACCES') return;
        throw err;
      }
      try {
        AppStorage.setWorkspaceRoot(linkRoot);
        const safe = await AppStorage.assertInWorkspace(file);
        expect(safe.endsWith('inside.md')).toBe(true);
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
      expect(safe.endsWith(join('..config', 'note.md'))).toBe(true);
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
