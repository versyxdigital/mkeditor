/**
 * Resolve a markdown image (or link) `src` value to a `file://` URL
 * rooted at the on-disk workspace, so the preview can load relative
 * asset paths like `![](collector.png)` from the folder the markdown
 * lives in.
 */
export interface ResolveContext {
  baseDir: string | null;
  workspaceRoot: string | null;
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

/**
 * Returns true if `src` is an explicit `file://...` URL.
 */
export function isFileSchemeUrl(src: string): boolean {
  return /^file:/i.test(src);
}

export function resolveLocalAssetSrc(
  src: string,
  ctx: ResolveContext,
): string | null {
  if (!src) return null;

  if (isFileSchemeUrl(src)) {
    return resolveFileSchemeUrl(src, ctx.workspaceRoot);
  }

  // Other absolute URL schemes (`http://`, `https://`, `data:`,
  // `mked:`, `blob:`, …) are pass-through.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(src)) return null;

  // Protocol-relative (`//example.com/img.png`) and in-page anchors
  // (`#section`) are user intent we don't rewrite.
  if (src.startsWith('//') || src.startsWith('#')) return null;

  // Decode percent-encoded sequences (e.g. `my%20notes.png` →
  // `my notes.png`) so the segment walk operates on real path
  // characters.
  let decoded: string;
  try {
    decoded = decodeURI(src);
  } catch {
    decoded = src;
  }
  const srcNorm = decoded.replace(/\\/g, '/');
  const isWindowsAbs = /^[a-zA-Z]:\//.test(srcNorm);
  const isPosixAbs = srcNorm.startsWith('/');

  let absolute: string;
  if (isWindowsAbs || isPosixAbs) {
    absolute = srcNorm;
  } else if (ctx.baseDir && isFilesystemPath(ctx.baseDir)) {
    const base = ctx.baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
    absolute = `${base}/${srcNorm}`;
  } else {
    return null;
  }

  const normalized = normalizeSegments(absolute);

  if (
    ctx.workspaceRoot !== null &&
    !isWithinWorkspace(normalized, ctx.workspaceRoot)
  ) {
    return null;
  }

  return toFileUrl(normalized);
}

/**
 * Parse a `file://` URL, run the same workspace-containment check
 * the relative branch runs, and return either a normalised
 * `file:///...` URL (contained) or null (rejected / unparsable).
 */
function resolveFileSchemeUrl(
  src: string,
  workspaceRoot: string | null,
): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (url.protocol !== 'file:') return null;
  // Chromium's `new URL('file://example.com/foo')` parses `example.com`
  // as the authority and `/foo` as the path. A non-empty, non-local
  // authority points at a foreign location, reject.
  if (url.host !== '' && url.host.toLowerCase() !== 'localhost') {
    return null;
  }
  // `url.pathname` is percent-encoded; decode for the containment
  // comparison and the segment walk. On Windows, Chromium encodes
  // `C:\foo` as `/C:/foo`, so strip the leading slash so it looks
  // like a real Windows path.
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  path = path.replace(/\\/g, '/');
  if (/^\/[a-zA-Z]:\//.test(path)) {
    path = path.slice(1);
  }
  if (!isFilesystemPath(path)) return null;

  const normalized = normalizeSegments(path);
  if (workspaceRoot !== null && !isWithinWorkspace(normalized, workspaceRoot)) {
    return null;
  }
  return toFileUrl(normalized);
}

function isFilesystemPath(p: string): boolean {
  const norm = p.replace(/\\/g, '/');
  return /^[a-zA-Z]:\//.test(norm) || norm.startsWith('/');
}

function isWithinWorkspace(absolute: string, workspaceRoot: string): boolean {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!root) return false;
  const windowsSide =
    /^[a-zA-Z]:\//.test(root) || /^[a-zA-Z]:\//.test(absolute);
  const a = windowsSide ? absolute.toLowerCase() : absolute;
  const r = windowsSide ? root.toLowerCase() : root;
  return a === r || a.startsWith(`${r}/`);
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
