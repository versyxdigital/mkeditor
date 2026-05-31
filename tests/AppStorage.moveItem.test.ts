/**
 * `AppStorage.moveItem` — drag-and-drop / Move-to support.
 *
 * Real-tmpdir tests (no fs mocking) so the rename + EXDEV fallback
 * path matches OS behaviour. A fake BrowserWindow captures
 * `webContents.send` calls so we can assert the side-effect events
 * (`from:folder:opened` for both ends, `from:path:renamed` for tabs).
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BrowserWindow } from 'electron';

import { AppStorage } from '../src/app/lib/AppStorage';

type SentMessage = { channel: string; payload: unknown };

function fakeWindow(): {
  context: BrowserWindow;
  sent: SentMessage[];
} {
  const sent: SentMessage[] = [];
  const context = {
    webContents: {
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload });
      },
    },
  } as unknown as BrowserWindow;
  return { context, sent };
}

function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'mkeditor-move-'));
  return fn(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

describe('AppStorage.moveItem', () => {
  afterEach(() => {
    AppStorage.setWorkspaceRoot(null);
  });

  it('moves a file from one folder to another and refreshes both parents', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      mkdirSync(join(root, 'a'));
      mkdirSync(join(root, 'b'));
      const src = join(root, 'a', 'note.md');
      const dst = join(root, 'b', 'note.md');
      writeFileSync(src, 'hello');

      const { context, sent } = fakeWindow();
      const result = await AppStorage.moveItem(context, src, dst);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.newPath.endsWith(join('b', 'note.md'))).toBe(true);

      // File is on disk at the new location, gone from the old.
      expect(readdirSync(join(root, 'b'))).toContain('note.md');
      expect(readdirSync(join(root, 'a'))).not.toContain('note.md');

      // Both parents refreshed.
      const folderOpened = sent.filter(
        (m) => m.channel === 'from:folder:opened',
      );
      expect(folderOpened).toHaveLength(2);
      const paths = folderOpened.map(
        (m) => (m.payload as { path: string }).path,
      );
      expect(paths.some((p) => p.endsWith(join(root, 'a')))).toBe(true);
      expect(paths.some((p) => p.endsWith(join(root, 'b')))).toBe(true);

      // Open tabs get notified.
      const renamed = sent.find((m) => m.channel === 'from:path:renamed');
      expect(renamed).toBeDefined();
      expect(renamed?.payload).toMatchObject({ name: 'note.md' });
    });
  });

  it('moves a directory recursively', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      mkdirSync(join(root, 'src', 'inner'), { recursive: true });
      writeFileSync(join(root, 'src', 'inner', 'note.md'), 'hi');
      mkdirSync(join(root, 'dst'));

      const { context } = fakeWindow();
      const result = await AppStorage.moveItem(
        context,
        join(root, 'src'),
        join(root, 'dst', 'src'),
      );
      expect(result.ok).toBe(true);

      expect(readdirSync(join(root, 'dst', 'src', 'inner'))).toContain(
        'note.md',
      );
      expect(readdirSync(root)).not.toContain('src');
    });
  });

  it('refuses to move into the same path (no-op)', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      const src = join(root, 'note.md');
      writeFileSync(src, 'hi');
      const { context } = fakeWindow();
      const result = await AppStorage.moveItem(context, src, src);
      expect(result).toEqual({
        ok: false,
        error: 'destination_same_as_source',
      });
    });
  });

  it('refuses to overwrite an existing destination', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      const src = join(root, 'a.md');
      const dst = join(root, 'b.md');
      writeFileSync(src, 'src');
      writeFileSync(dst, 'pre-existing');
      const { context } = fakeWindow();
      const result = await AppStorage.moveItem(context, src, dst);
      expect(result).toEqual({ ok: false, error: 'destination_exists' });
      // Neither end was touched.
      expect(readdirSync(root).sort()).toEqual(['a.md', 'b.md']);
    });
  });

  it('refuses to move a directory into itself', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      mkdirSync(join(root, 'a'));
      const { context } = fakeWindow();
      const result = await AppStorage.moveItem(
        context,
        join(root, 'a'),
        join(root, 'a', 'a'),
      );
      expect(result).toEqual({
        ok: false,
        error: 'destination_inside_source',
      });
      expect(readdirSync(root)).toContain('a');
    });
  });

  it('refuses to move a directory into one of its descendants', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      mkdirSync(join(root, 'a', 'inner'), { recursive: true });
      const { context } = fakeWindow();
      const result = await AppStorage.moveItem(
        context,
        join(root, 'a'),
        join(root, 'a', 'inner', 'a'),
      );
      expect(result).toEqual({
        ok: false,
        error: 'destination_inside_source',
      });
    });
  });

  it('refuses when the destination parent does not exist (no auto-mkdir)', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      const src = join(root, 'note.md');
      writeFileSync(src, 'hi');
      const { context } = fakeWindow();
      const result = await AppStorage.moveItem(
        context,
        src,
        join(root, 'never-exists', 'note.md'),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error).toBe('destination_parent_missing');
      // Source still in place.
      expect(readdirSync(root)).toContain('note.md');
    });
  });

  it('refuses to move a file outside the workspace', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      const src = join(root, 'note.md');
      writeFileSync(src, 'hi');
      const { context } = fakeWindow();
      // `..` escapes the workspace.
      const result = await AppStorage.moveItem(
        context,
        src,
        join(root, '..', 'escape.md'),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error).toMatch(/outside the workspace/);
    });
  });

  it('refuses to move FROM a location outside the workspace', async () => {
    await withTempRoot(async (root) => {
      await withTempRoot(async (other) => {
        // The source file lives in a *different* tmpdir, but we tell
        // AppStorage the workspace root is `root`. moveItem must
        // refuse since the source is outside the workspace.
        const otherSrc = join(other, 'stray.md');
        writeFileSync(otherSrc, 'stray');
        AppStorage.setWorkspaceRoot(root);
        const { context } = fakeWindow();
        const result = await AppStorage.moveItem(
          context,
          otherSrc,
          join(root, 'stray.md'),
        );
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.error).toMatch(/outside the workspace/);
      });
    });
  });

  it('returns a structured "File not found" error when the source is missing', async () => {
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      mkdirSync(join(root, 'dst'));
      const { context } = fakeWindow();
      const result = await AppStorage.moveItem(
        context,
        join(root, 'no-such.md'),
        join(root, 'dst', 'no-such.md'),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error).toMatch(/File not found/);
    });
  });

  it('emits from:path:renamed carrying the new basename so the tab title updates', async () => {
    // Move that also renames (a.md → renamed.md while changing
    // parent). The renderer side uses `name` to update the open-tab
    // label without re-reading.
    await withTempRoot(async (root) => {
      AppStorage.setWorkspaceRoot(root);
      mkdirSync(join(root, 'b'));
      const src = join(root, 'a.md');
      const dst = join(root, 'b', 'renamed.md');
      writeFileSync(src, 'hi');
      const { context, sent } = fakeWindow();
      const result = await AppStorage.moveItem(context, src, dst);
      expect(result.ok).toBe(true);
      const renamed = sent.find((m) => m.channel === 'from:path:renamed');
      expect(renamed).toBeDefined();
      expect(renamed?.payload).toMatchObject({ name: 'renamed.md' });
    });
  });
});
