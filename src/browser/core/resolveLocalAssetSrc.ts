/**
 * Resolve a markdown image (or link) `src` value to a `file://` URL
 * rooted at the on-disk workspace, so the preview can load relative
 * asset paths like `![](collector.png)` from the folder the markdown
 * lives in.
 */
export interface ResolveContext {
  baseDir: string | null;
}

/**
 * Returns true if `src` is a purely-relative path that needs a
 * baseDir to resolve.
 */
export function isPurelyRelativeAssetPath(src: string): boolean {
  if (!src) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(src)) return false;
  if (src.startsWith('//') || src.startsWith('#')) return false;
  if (/^[a-zA-Z]:[\\/]/.test(src) || src.startsWith('/')) return false;
  return true;
}

export function resolveLocalAssetSrc(
  src: string,
  ctx: ResolveContext,
): string | null {
  if (!src) return null;

  // Pre-existing absolute URL with a scheme (`http://`, `https://`,
  // `data:`, `file:`, `mked:`, `blob:`, …).
  if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(src)) return null;

  // Protocol-relative (`//example.com/img.png`) and in-page anchors
  // (`#section`) are user intent we don't rewrite.
  if (src.startsWith('//') || src.startsWith('#')) return null;

  const srcNorm = src.replace(/\\/g, '/');
  const isWindowsAbs = /^[a-zA-Z]:\//.test(srcNorm);
  const isPosixAbs = srcNorm.startsWith('/');

  let absolute: string;
  if (isWindowsAbs || isPosixAbs) {
    absolute = srcNorm;
  } else if (ctx.baseDir) {
    const base = ctx.baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
    absolute = `${base}/${srcNorm}`;
  } else {
    return null;
  }

  return toFileUrl(normalizeSegments(absolute));
}

/**
 * Resolve `.`/`..` segments and collapse empty ones, preserving:
 *   - the leading `/` on POSIX paths (kept as a leading empty segment)
 *   - a Windows drive letter (`C:`) at index 0
 */
function normalizeSegments(absolute: string): string {
  const segments = absolute.split('/');
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '') {
      if (out.length === 0) out.push('');
      continue;
    }
    if (seg === '.') continue;
    if (seg === '..') {
      // Pop unless we'd escape past the root.
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

function toFileUrl(absPath: string): string {
  // URL-encode each segment so paths with spaces / unicode survive
  // round-trip.
  const encoded = absPath
    .split('/')
    .map((seg) => (/^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/');
  // Windows: `C:/foo/bar.png` → `file:///C:/foo/bar.png`
  // POSIX:   `/foo/bar.png`   → `file:///foo/bar.png` (the leading
  //                            empty segment becomes the third slash)
  if (/^[a-zA-Z]:\//.test(encoded)) return `file:///${encoded}`;
  return `file://${encoded}`;
}

/**
 * Helper: derive the directory portion of a file path.
 */
export function dirnameOf(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  if (idx < 0) return '';
  return norm.slice(0, idx);
}
