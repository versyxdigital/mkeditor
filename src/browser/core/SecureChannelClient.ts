/**
 * SecureChannelClient
 *
 * Renderer-side counterpart to main's `SecureChannel`. Owns the
 * imported public key (lazy, fetched once) and exposes a single
 * `encryptString` that returns base64 ciphertext suitable for the
 * `to:ai:key:set` (or any future secret-carrying) IPC payload.
 *
 * Why this lives in `core/`: it's data + IPC plumbing, not UI. The
 * settings UI calls `AssistantManager.setKey(provider, plaintext)`,
 * which awaits encryption here before it ever touches `bridge.send`.
 *
 * Why lazy import: `crypto.subtle.importKey` is async; doing it on
 * module load would force every consumer to await an initialiser
 * they don't otherwise care about. Lazy + cached means the first
 * `encryptString` pays the import cost (~1 ms), subsequent calls
 * reuse the same CryptoKey.
 */

let importedKey: Promise<CryptoKey> | null = null;

function loadKey(): Promise<CryptoKey> {
  if (importedKey) return importedKey;
  const spkiBase64 = window.mked?.secureChannelPublicKey?.();
  if (!spkiBase64) {
    return Promise.reject(
      new Error(
        'SecureChannelClient: no public key available (web mode? main-process bridge missing?)',
      ),
    );
  }
  const der = base64ToArrayBuffer(spkiBase64);
  importedKey = crypto.subtle.importKey(
    'spki',
    der,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    /* extractable */ false,
    ['encrypt'],
  );
  return importedKey;
}

/**
 * Encrypt a UTF-8 plaintext (e.g. a user-supplied API key) under
 * main's RSA-OAEP public key. Returns base64 ciphertext suitable
 * for a `to:ai:key:set` payload's `ciphertext` field.
 *
 * RSA-OAEP-2048 with SHA-256 caps plaintext at 190 bytes — plenty
 * for any sensible API key (Anthropic / OpenAI keys are ~50–100
 * bytes). If a caller exceeds the cap, Web Crypto throws and we
 * surface that.
 */
export async function encryptForMain(plaintext: string): Promise<string> {
  const key = await loadKey();
  const bytes = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    bytes,
  );
  return arrayBufferToBase64(cipherBuffer);
}

/**
 * Drop the cached imported key. Test seam; production never needs
 * to call this — the keypair is per-app-session and the renderer
 * outlives any single key entry.
 */
export function _resetForTests(): void {
  importedKey = null;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  // Chunked loop avoids "Maximum call stack size exceeded" on big
  // buffers — though RSA-OAEP-2048 caps at 256 bytes so this is
  // belt-and-braces.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
