/**
 * `WebFileBridge.normalizeVirtualPath` — POSIX-style segment
 * resolution for virtual workspace paths. Mirrors Node's
 * `path.resolve` behaviour the desktop side gets for free.
 *
 * Tested in isolation so the regression matrix doesn't have to mock
 * the entire FileSystemDirectoryHandle surface; the function is
 * pure and exported solely for this test.
 */

import { normalizeVirtualPath } from '../src/browser/core/WebFileBridge';

describe('normalizeVirtualPath', () => {
  it('passes a clean rooted path through unchanged', () => {
    expect(normalizeVirtualPath('myworkspace/sub/assets', 'myworkspace')).toBe(
      'myworkspace/sub/assets',
    );
  });

  it('collapses redundant separators', () => {
    expect(
      normalizeVirtualPath('myworkspace//sub///assets', 'myworkspace'),
    ).toBe('myworkspace/sub/assets');
  });

  it('strips trailing slashes', () => {
    // The trailing-slash strip happens in `resolvePasteTargetDir`
    // but `normalizeVirtualPath` should also collapse the empty
    // segment defensively.
    expect(normalizeVirtualPath('myworkspace/sub/assets/', 'myworkspace')).toBe(
      'myworkspace/sub/assets',
    );
  });

  it('resolves `.` segments', () => {
    expect(
      normalizeVirtualPath('myworkspace/./sub/./assets', 'myworkspace'),
    ).toBe('myworkspace/sub/assets');
  });

  it('resolves `..` segments', () => {
    expect(
      normalizeVirtualPath('myworkspace/sub/../assets', 'myworkspace'),
    ).toBe('myworkspace/assets');
  });

  it('clamps `..` walks at the workspace root (does NOT escape)', () => {
    // Without the clamp, an over-greedy paste-images setting like
    // `../../../assets` would pop past `myworkspace` and produce
    // an unrooted virtual path. We clamp at the root and keep the
    // walk stable.
    expect(
      normalizeVirtualPath(
        'myworkspace/sub/../../../../../assets',
        'myworkspace',
      ),
    ).toBe('myworkspace/assets');
  });

  it('returns the bare workspace root when nothing else survives', () => {
    expect(normalizeVirtualPath('myworkspace', 'myworkspace')).toBe(
      'myworkspace',
    );
    expect(normalizeVirtualPath('myworkspace/sub/..', 'myworkspace')).toBe(
      'myworkspace',
    );
    expect(normalizeVirtualPath('myworkspace/.', 'myworkspace')).toBe(
      'myworkspace',
    );
  });

  it('falls back to the workspace root when the input drops below it', () => {
    // Defence-in-depth: a malformed input that doesn't even start
    // with the workspace name shouldn't slip through silently.
    expect(normalizeVirtualPath('elsewhere/assets', 'myworkspace')).toBe(
      'myworkspace',
    );
    expect(normalizeVirtualPath('', 'myworkspace')).toBe('myworkspace');
    expect(normalizeVirtualPath('/', 'myworkspace')).toBe('myworkspace');
  });

  it('keeps a folder name that legitimately starts with `..` (no false-positive parent-walk)', () => {
    // Segments equal `..` are parent-walks; segments like `..config`
    // are real folder names and must survive the walk unchanged.
    expect(
      normalizeVirtualPath('myworkspace/..config/notes', 'myworkspace'),
    ).toBe('myworkspace/..config/notes');
  });
});
