// Removed legacy service-locator provider registry

/**
 * Get the path from a URL
 *
 * @param uri - e.g. file://
 * @returns - the file path
 */
export function getPathFromUrl(uri: string) {
  const url = new URL(uri);
  let p = decodeURIComponent(url.pathname);
  if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(p)) {
    p = p.slice(1);
  }
  return p;
}

/**
 * Deep-merge source into target, preferring values from source when present.
 *
 * @param target - target object
 * @param source - source object
 * @returns - merged object
 */
export function deepMerge<T>(target: T, source: Partial<T>): T {
  if (typeof target !== 'object' || target === null) {
    return source as T;
  }

  const out: any = Array.isArray(target)
    ? [...(target as any)]
    : { ...(target as any) };

  if (typeof source !== 'object' || source === null) {
    return out;
  }

  for (const k of Object.keys(source)) {
    const val: any = (source as any)[k];

    if (val && typeof val === 'object' && !Array.isArray(val)) {
      out[k] = deepMerge((out as any)[k] ?? {}, val);
    } else {
      out[k] = val;
    }
  }

  return out;
}

/**
 * Recursively check that `obj` has all keys present in `defaults` (types ignored).
 *
 * @param a - target
 * @param b - comparison
 * @returns
 */
export function hasAllKeys(a: any, b: any): boolean {
  if (typeof a !== 'object' || a === null) {
    return true;
  }

  if (typeof b !== 'object' || b === null) {
    return false;
  }

  for (const k of Object.keys(a)) {
    if (!(k in b)) {
      return false;
    }

    if (typeof a[k] === 'object' && a[k] !== null) {
      if (!hasAllKeys(a[k], b[k])) return false;
    }
  }

  return true;
}

/**
 * Normalize the language, map BCP-47 to base language.
 * E.g. en-GB -> en
 *
 * @param lng - the language to load
 * @returns
 */
export function normalizeLanguage(lng: string | null | undefined) {
  if (!lng) return 'en';
  const base = lng.toLowerCase().split(/[-_]/)[0];
  return base || 'en';
}
