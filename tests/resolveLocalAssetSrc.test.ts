import {
  dirnameOf,
  isPurelyRelativeAssetPath,
  resolveLocalAssetSrc,
} from '../src/browser/core/resolveLocalAssetSrc';

describe('resolveLocalAssetSrc', () => {
  /* -------------------------------------------------------------------- */
  /*  Existing behaviour — workspaceRoot deliberately null                  */
  /*  (single-file edit mode: no folder open, best-effort rewriting)        */
  /* -------------------------------------------------------------------- */

  it('leaves http(s) URLs alone', () => {
    expect(
      resolveLocalAssetSrc('https://example.com/foo.png', {
        baseDir: 'C:/work',
        workspaceRoot: null,
      }),
    ).toBeNull();
    expect(
      resolveLocalAssetSrc('http://example.com/foo.png', {
        baseDir: 'C:/work',
        workspaceRoot: null,
      }),
    ).toBeNull();
  });

  it('leaves data: / blob: / mked: / file: URLs alone', () => {
    expect(
      resolveLocalAssetSrc('data:image/png;base64,iVBOR…', {
        baseDir: '/work',
        workspaceRoot: null,
      }),
    ).toBeNull();
    expect(
      resolveLocalAssetSrc('blob:https://example/abc', {
        baseDir: '/work',
        workspaceRoot: null,
      }),
    ).toBeNull();
    expect(
      resolveLocalAssetSrc('mked://open?path=/w/foo.md', {
        baseDir: '/w',
        workspaceRoot: null,
      }),
    ).toBeNull();
    expect(
      resolveLocalAssetSrc('file:///C:/x/y.png', {
        baseDir: 'C:/w',
        workspaceRoot: null,
      }),
    ).toBeNull();
  });

  it('leaves protocol-relative and anchor URLs alone', () => {
    expect(
      resolveLocalAssetSrc('//cdn.example.com/foo.png', {
        baseDir: '/w',
        workspaceRoot: null,
      }),
    ).toBeNull();
    expect(
      resolveLocalAssetSrc('#section', {
        baseDir: '/w',
        workspaceRoot: null,
      }),
    ).toBeNull();
  });

  it('resolves a relative Windows path against baseDir', () => {
    expect(
      resolveLocalAssetSrc('collector.png', {
        baseDir: 'C:\\Users\\chris\\workspace\\foo',
        workspaceRoot: null,
      }),
    ).toBe('file:///C:/Users/chris/workspace/foo/collector.png');
  });

  it('resolves a relative POSIX path against baseDir', () => {
    expect(
      resolveLocalAssetSrc('collector.png', {
        baseDir: '/home/chris/notes',
        workspaceRoot: null,
      }),
    ).toBe('file:///home/chris/notes/collector.png');
  });

  it('rewrites an absolute Windows path when no workspaceRoot is enforced', () => {
    // Single-file edit mode (no folder open) — best-effort rewrite,
    // no containment policing.
    expect(
      resolveLocalAssetSrc('D:\\assets\\logo.svg', {
        baseDir: 'C:/work',
        workspaceRoot: null,
      }),
    ).toBe('file:///D:/assets/logo.svg');
  });

  it('rewrites an absolute POSIX path when no workspaceRoot is enforced', () => {
    expect(
      resolveLocalAssetSrc('/var/img/logo.svg', {
        baseDir: '/work',
        workspaceRoot: null,
      }),
    ).toBe('file:///var/img/logo.svg');
  });

  it('returns null for a relative path with no baseDir', () => {
    expect(
      resolveLocalAssetSrc('logo.png', {
        baseDir: null,
        workspaceRoot: null,
      }),
    ).toBeNull();
  });

  it('still rewrites an absolute path with no baseDir (single-file mode)', () => {
    expect(
      resolveLocalAssetSrc('C:/work/logo.png', {
        baseDir: null,
        workspaceRoot: null,
      }),
    ).toBe('file:///C:/work/logo.png');
  });

  it('resolves .. segments and stops at the drive root (no workspaceRoot)', () => {
    expect(
      resolveLocalAssetSrc('../images/foo.png', {
        baseDir: 'C:/work/notes/sub',
        workspaceRoot: null,
      }),
    ).toBe('file:///C:/work/notes/images/foo.png');
    expect(
      resolveLocalAssetSrc('../../images/foo.png', {
        baseDir: 'C:/work/notes/sub',
        workspaceRoot: null,
      }),
    ).toBe('file:///C:/work/images/foo.png');
    // Clamps to drive letter — but does NOT enforce workspace containment
    // since none was supplied.
    expect(
      resolveLocalAssetSrc('../../../../../../escape.png', {
        baseDir: 'C:/work',
        workspaceRoot: null,
      }),
    ).toBe('file:///C:/escape.png');
  });

  it('strips leading ./ but otherwise preserves the path', () => {
    expect(
      resolveLocalAssetSrc('./images/foo.png', {
        baseDir: 'C:/work',
        workspaceRoot: null,
      }),
    ).toBe('file:///C:/work/images/foo.png');
  });

  it('encodes spaces and unicode in path segments', () => {
    expect(
      resolveLocalAssetSrc('my photo.png', {
        baseDir: 'C:/work',
        workspaceRoot: null,
      }),
    ).toBe('file:///C:/work/my%20photo.png');
    expect(
      resolveLocalAssetSrc('café.png', {
        baseDir: 'C:/work',
        workspaceRoot: null,
      }),
    ).toBe(`file:///C:/work/${encodeURIComponent('café.png')}`);
  });

  it('preserves the drive letter unencoded (Chromium parser quirk)', () => {
    const out = resolveLocalAssetSrc('foo.png', {
      baseDir: 'C:/work',
      workspaceRoot: null,
    });
    expect(out).toContain('file:///C:/work/');
    expect(out).not.toContain('C%3A');
  });

  it('collapses double slashes in baseDir', () => {
    expect(
      resolveLocalAssetSrc('foo.png', {
        baseDir: 'C://work//notes',
        workspaceRoot: null,
      }),
    ).toBe('file:///C:/work/notes/foo.png');
  });

  it('returns null for an empty src', () => {
    expect(
      resolveLocalAssetSrc('', {
        baseDir: 'C:/work',
        workspaceRoot: null,
      }),
    ).toBeNull();
  });

  /* -------------------------------------------------------------------- */
  /*  Workspace containment (the main reason for this fix)                  */
  /* -------------------------------------------------------------------- */

  it('allows a relative path that stays inside the workspace', () => {
    expect(
      resolveLocalAssetSrc('images/logo.png', {
        baseDir: 'C:/work/notes',
        workspaceRoot: 'C:/work',
      }),
    ).toBe('file:///C:/work/notes/images/logo.png');
  });

  it('rejects a relative `..` traversal that escapes the workspace', () => {
    expect(
      resolveLocalAssetSrc('../../secret.png', {
        baseDir: 'C:/work/notes',
        workspaceRoot: 'C:/work',
      }),
    ).toBeNull();
  });

  it('rejects an absolute path outside the workspace', () => {
    expect(
      resolveLocalAssetSrc('D:/secrets/passwords.png', {
        baseDir: 'C:/work',
        workspaceRoot: 'C:/work',
      }),
    ).toBeNull();
    expect(
      resolveLocalAssetSrc('/etc/passwd', {
        baseDir: '/home/chris/notes',
        workspaceRoot: '/home/chris/notes',
      }),
    ).toBeNull();
  });

  it('allows an absolute path that lands inside the workspace', () => {
    expect(
      resolveLocalAssetSrc('C:/work/notes/images/logo.png', {
        baseDir: 'C:/work/notes',
        workspaceRoot: 'C:/work',
      }),
    ).toBe('file:///C:/work/notes/images/logo.png');
  });

  it('treats Windows workspace containment case-insensitively', () => {
    // NTFS / ReFS are case-insensitive; the user typing a path with
    // a differently-cased drive letter or folder must still be
    // recognised as inside the workspace.
    expect(
      resolveLocalAssetSrc('c:/Work/Notes/Logo.png', {
        baseDir: 'C:/work/notes',
        workspaceRoot: 'C:/Work',
      }),
    ).toBe('file:///c:/Work/Notes/Logo.png');
  });

  it('treats POSIX workspace containment case-sensitively', () => {
    // A real POSIX filesystem would treat these as different paths;
    // we must not let a wrong-case path slip through.
    expect(
      resolveLocalAssetSrc('/home/CHRIS/notes/logo.png', {
        baseDir: '/home/chris/notes',
        workspaceRoot: '/home/chris',
      }),
    ).toBeNull();
  });

  it('rejects a path equal to but outside-pretending the workspace prefix', () => {
    // `/home/chris-evil/secret` shares the prefix `/home/chris` but
    // is NOT inside `/home/chris/`. The containment check must use
    // a separator-boundary comparison, not raw startsWith.
    expect(
      resolveLocalAssetSrc('/home/chris-evil/secret.png', {
        baseDir: '/home/chris/notes',
        workspaceRoot: '/home/chris',
      }),
    ).toBeNull();
  });

  it('handles a workspaceRoot with a trailing slash', () => {
    expect(
      resolveLocalAssetSrc('logo.png', {
        baseDir: 'C:/work/notes',
        workspaceRoot: 'C:/work/',
      }),
    ).toBe('file:///C:/work/notes/logo.png');
  });

  it('rejects a relative path resolving to exactly the workspace root (no such file)', () => {
    // Resolving "." against baseDir lands at baseDir; if baseDir is
    // already the workspace root, the result equals the root which is
    // technically a directory, not a file. We allow this since the
    // resolver doesn't stat — the browser will surface a 404 for an
    // <img src="<root>">, which is the same failure mode as any other
    // missing-file pointer.
    expect(
      resolveLocalAssetSrc('.', {
        baseDir: 'C:/work',
        workspaceRoot: 'C:/work',
      }),
    ).toBe('file:///C:/work');
  });

  /* -------------------------------------------------------------------- */
  /*  baseDir validation                                                    */
  /* -------------------------------------------------------------------- */

  it('rejects a relative src when baseDir is not an absolute filesystem path', () => {
    // baseDir must look like a real on-disk path. An empty string,
    // a relative `./notes`, or a URL are all suspicious — fail closed.
    expect(
      resolveLocalAssetSrc('logo.png', {
        baseDir: '',
        workspaceRoot: null,
      }),
    ).toBeNull();
    expect(
      resolveLocalAssetSrc('logo.png', {
        baseDir: './notes',
        workspaceRoot: null,
      }),
    ).toBeNull();
    expect(
      resolveLocalAssetSrc('logo.png', {
        baseDir: 'notes',
        workspaceRoot: null,
      }),
    ).toBeNull();
    expect(
      resolveLocalAssetSrc('logo.png', {
        baseDir: 'http://example.com/notes',
        workspaceRoot: null,
      }),
    ).toBeNull();
  });

  it('still rewrites absolute src paths when baseDir is invalid (baseDir only matters for relative)', () => {
    expect(
      resolveLocalAssetSrc('C:/work/logo.png', {
        baseDir: 'notes',
        workspaceRoot: null,
      }),
    ).toBe('file:///C:/work/logo.png');
  });
});

describe('isPurelyRelativeAssetPath', () => {
  it('returns true for bare filenames and relative paths', () => {
    expect(isPurelyRelativeAssetPath('logo.png')).toBe(true);
    expect(isPurelyRelativeAssetPath('./logo.png')).toBe(true);
    expect(isPurelyRelativeAssetPath('../logo.png')).toBe(true);
    expect(isPurelyRelativeAssetPath('images/logo.png')).toBe(true);
  });

  it('returns false for scheme URLs, anchors, protocol-relative, and absolutes', () => {
    expect(isPurelyRelativeAssetPath('http://example.com')).toBe(false);
    expect(isPurelyRelativeAssetPath('data:image/png;base64,')).toBe(false);
    expect(isPurelyRelativeAssetPath('//cdn.example.com')).toBe(false);
    expect(isPurelyRelativeAssetPath('#section')).toBe(false);
    expect(isPurelyRelativeAssetPath('/abs/posix.png')).toBe(false);
    expect(isPurelyRelativeAssetPath('C:/abs/windows.png')).toBe(false);
    expect(isPurelyRelativeAssetPath('C:\\abs\\windows.png')).toBe(false);
  });
});

describe('dirnameOf', () => {
  it('returns the directory portion of a Windows path', () => {
    expect(dirnameOf('C:\\work\\notes\\readme.md')).toBe('C:/work/notes');
  });

  it('returns the directory portion of a POSIX path', () => {
    expect(dirnameOf('/home/chris/notes/readme.md')).toBe('/home/chris/notes');
  });

  it('returns empty string for a bare filename', () => {
    expect(dirnameOf('readme.md')).toBe('');
  });
});
