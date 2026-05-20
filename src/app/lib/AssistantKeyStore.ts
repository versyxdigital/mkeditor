import { safeStorage } from 'electron';
import type { ApiProviderId } from '../interfaces/Assistant';
import { loadAssistantStore, writeAssistantStore } from './assistantStoreFile';

/**
 * AssistantKeyStore
 *
 * Owns the encrypted API-key portion of `~/.mkeditor/assistant.json`.
 *
 * Keys for the API-key-bearing providers (Anthropic, OpenAI) are
 * encrypted with Electron's `safeStorage` (Keychain on macOS, DPAPI on
 * Windows, kwallet/gnome-keyring/basic-text on Linux) and base64-encoded
 * for JSON storage. A key value never leaves this module unless callers
 * invoke `getKey()` — and even then only inside the main process. The
 * `from:ai:*` channels only ever ship `hasKey: boolean` outward.
 *
 * Encryption availability is checked once per process and cached. On
 * platforms where `safeStorage.isEncryptionAvailable()` returns false
 * (notably some Linux configurations) we refuse to persist any new key
 * and `hasKey()` always returns false — the renderer disables remote
 * providers in that case.
 *
 * File I/O is delegated to `assistantStoreFile.ts` so this class and
 * `AssistantConfig` share a single read/write surface for the same
 * JSON blob.
 */
export class AssistantKeyStore {
  /** Cached after first probe so we don't re-call safeStorage on every operation. */
  private static encryptionAvailableCache: boolean | null = null;

  /**
   * Whether `safeStorage` can encrypt/decrypt on this platform. Cached
   * after the first call. The AppBridge pushes this flag into the
   * renderer's `from:ai:config` payload so the settings UI can show the
   * "encryption unavailable" warning when needed.
   */
  static isEncryptionAvailable(): boolean {
    if (AssistantKeyStore.encryptionAvailableCache === null) {
      try {
        AssistantKeyStore.encryptionAvailableCache =
          safeStorage.isEncryptionAvailable();
      } catch {
        AssistantKeyStore.encryptionAvailableCache = false;
      }
    }
    return AssistantKeyStore.encryptionAvailableCache;
  }

  /**
   * Decrypt and return the API key for an API-key-bearing provider, or
   * null if none is stored / encryption is unavailable / decryption
   * fails. Never throws. Callers (currently only `AppAssistant.chat`)
   * use the result to construct the SDK client and **must not** log it.
   */
  static getKey(provider: ApiProviderId): string | null {
    if (!AssistantKeyStore.isEncryptionAvailable()) return null;
    const store = loadAssistantStore();
    const encoded = store.keys[provider];
    if (!encoded) return null;
    try {
      const buf = Buffer.from(encoded, 'base64');
      return safeStorage.decryptString(buf);
    } catch {
      // Stored ciphertext is unreadable (corrupted on disk, OS keychain
      // rotated, different user, etc). Treat as no key.
      return null;
    }
  }

  /**
   * Cheap boolean check used by `from:ai:config` to surface whether a
   * provider is "connected" without exposing the key value. Does not
   * decrypt; just checks for the entry's presence in the file.
   */
  static hasKey(provider: ApiProviderId): boolean {
    if (!AssistantKeyStore.isEncryptionAvailable()) return false;
    const store = loadAssistantStore();
    const value = store.keys[provider];
    return typeof value === 'string' && value.length > 0;
  }

  /**
   * Encrypt and persist a key for the given provider. Returns true on
   * success, false if encryption is unavailable or the write fails. The
   * AppBridge handler should respond with a fresh `from:ai:config` push
   * regardless so the renderer's UI reflects the actual on-disk state.
   */
  static setKey(provider: ApiProviderId, key: string): boolean {
    if (!AssistantKeyStore.isEncryptionAvailable()) return false;
    let encoded: string;
    try {
      encoded = safeStorage.encryptString(key).toString('base64');
    } catch {
      return false;
    }
    const store = loadAssistantStore();
    store.keys = { ...store.keys, [provider]: encoded };
    return writeAssistantStore(store);
  }

  /**
   * Remove the stored key for the given provider. Returns true on
   * success (including the no-op case where no key was stored).
   */
  static clearKey(provider: ApiProviderId): boolean {
    const store = loadAssistantStore();
    if (!(provider in store.keys)) return true;
    const nextKeys = { ...store.keys };
    delete nextKeys[provider];
    store.keys = nextKeys;
    return writeAssistantStore(store);
  }

  /**
   * Hard-reset the encryption-availability cache. Test-only — the cache
   * is intentionally process-wide in production, and the renderer never
   * needs to clear it.
   */
  static _resetEncryptionCacheForTests(): void {
    AssistantKeyStore.encryptionAvailableCache = null;
  }
}
