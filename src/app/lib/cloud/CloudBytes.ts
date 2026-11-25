/** Runtime-neutral byte helpers shared by browser and desktop cloud transports. */
export const utf8 = (value: string): Uint8Array =>
  new TextEncoder().encode(value);

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    chunks.reduce((size, chunk) => size + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export const randomBoundary = (): string =>
  [...globalThis.crypto.getRandomValues(new Uint8Array(18))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

export function encodePlan(value: unknown): string {
  return btoa(
    Array.from(utf8(JSON.stringify(value)), (byte) =>
      String.fromCharCode(byte),
    ).join(''),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodePlan(value: string): unknown {
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(
        atob(value.replace(/-/g, '+').replace(/_/g, '/')),
        (character) => character.charCodeAt(0),
      ),
    ),
  );
}

/** Dropbox hashes the concatenated SHA-256 hashes of its 4 MiB blocks. */
export async function browserDropboxContentHash(
  content: Uint8Array,
): Promise<string> {
  const hashes: Uint8Array[] = [];
  for (let offset = 0; offset < content.length; offset += 4 * 1024 * 1024) {
    const bytes = new Uint8Array(
      content.subarray(offset, offset + 4 * 1024 * 1024),
    );
    hashes.push(
      new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)),
    );
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(concatBytes(hashes)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
