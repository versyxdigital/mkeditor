import {
  dirnameOf,
  resolveLocalAssetSrc,
} from '../src/browser/core/resolveLocalAssetSrc';

describe('resolveLocalAssetSrc', () => {
  it('leaves http(s) URLs alone', () => {
    expect(
      resolveLocalAssetSrc('https://example.com/foo.png', {
        baseDir: 'C:/work',
      }),
    ).toBeNull();
    expect(
      resolveLocalAssetSrc('http://example.com/foo.png', {
        baseDir: 'C:/work',
      }),
    ).toBeNull();
  });

  it('leaves data: / blob: / mked: / file: URLs alone', () => {
    expect(
      resolveLocalAssetSrc('data:image/png;base64,iVBOR…', {
        baseDir: '/work',
      }),
    ).toBeNull();
    expect(
      resolveLocalAssetSrc('blob:https://example/abc', { baseDir: '/work' }),
    ).toBeNull();
    expect(
      resolveLocalAssetSrc('mked://open?path=/w/foo.md', { baseDir: '/w' }),
    ).toBeNull();
    expect(
      resolveLocalAssetSrc('file:///C:/x/y.png', { baseDir: 'C:/w' }),
    ).toBeNull();
  });

  it('leaves protocol-relative and anchor URLs alone', () => {
    expect(
      resolveLocalAssetSrc('//cdn.example.com/foo.png', { baseDir: '/w' }),
    ).toBeNull();
    expect(resolveLocalAssetSrc('#section', { baseDir: '/w' })).toBeNull();
  });

  it('resolves a relative Windows path against baseDir', () => {
    expect(
      resolveLocalAssetSrc('collector.png', {
        baseDir: 'C:\\Users\\chris\\workspace\\foo',
      }),
    ).toBe('file:///C:/Users/chris/workspace/foo/collector.png');
  });

  it('resolves a relative POSIX path against baseDir', () => {
    expect(
      resolveLocalAssetSrc('collector.png', {
        baseDir: '/home/chris/notes',
      }),
    ).toBe('file:///home/chris/notes/collector.png');
  });

  it('rewrites an absolute Windows path even when baseDir is unrelated', () => {
    expect(
      resolveLocalAssetSrc('D:\\assets\\logo.svg', {
        baseDir: 'C:/work',
      }),
    ).toBe('file:///D:/assets/logo.svg');
  });

  it('rewrites an absolute POSIX path', () => {
    expect(
      resolveLocalAssetSrc('/var/img/logo.svg', { baseDir: '/work' }),
    ).toBe('file:///var/img/logo.svg');
  });

  it('returns null for a relative path with no baseDir', () => {
    expect(resolveLocalAssetSrc('logo.png', { baseDir: null })).toBeNull();
  });

  it('still rewrites an absolute path with no baseDir', () => {
    expect(resolveLocalAssetSrc('C:/work/logo.png', { baseDir: null })).toBe(
      'file:///C:/work/logo.png',
    );
  });

  it('resolves .. segments and stops at the drive root', () => {
    expect(
      resolveLocalAssetSrc('../images/foo.png', {
        baseDir: 'C:/work/notes/sub',
      }),
    ).toBe('file:///C:/work/notes/images/foo.png');
    expect(
      resolveLocalAssetSrc('../../images/foo.png', {
        baseDir: 'C:/work/notes/sub',
      }),
    ).toBe('file:///C:/work/images/foo.png');
    // Don't let .. walk above the drive letter.
    expect(
      resolveLocalAssetSrc('../../../../../../escape.png', {
        baseDir: 'C:/work',
      }),
    ).toBe('file:///C:/escape.png');
  });

  it('strips leading ./ but otherwise preserves the path', () => {
    expect(
      resolveLocalAssetSrc('./images/foo.png', {
        baseDir: 'C:/work',
      }),
    ).toBe('file:///C:/work/images/foo.png');
  });

  it('encodes spaces and unicode in path segments', () => {
    expect(resolveLocalAssetSrc('my photo.png', { baseDir: 'C:/work' })).toBe(
      'file:///C:/work/my%20photo.png',
    );
    expect(resolveLocalAssetSrc('café.png', { baseDir: 'C:/work' })).toBe(
      `file:///C:/work/${encodeURIComponent('café.png')}`,
    );
  });

  it('preserves the drive letter unencoded (Chromium parser quirk)', () => {
    const out = resolveLocalAssetSrc('foo.png', { baseDir: 'C:/work' });
    expect(out).toContain('file:///C:/work/');
    expect(out).not.toContain('C%3A');
  });

  it('collapses double slashes in baseDir', () => {
    expect(
      resolveLocalAssetSrc('foo.png', { baseDir: 'C://work//notes' }),
    ).toBe('file:///C:/work/notes/foo.png');
  });

  it('returns null for an empty src', () => {
    expect(resolveLocalAssetSrc('', { baseDir: 'C:/work' })).toBeNull();
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
