import {
  generateKeyPairSync,
  privateDecrypt,
  constants as cryptoConstants,
  type KeyObject,
} from 'crypto';

/**
 * SecureChannel
 *
 * One-way confidentiality for renderer → main secrets (today: API
 * keys; tomorrow: anything else the renderer must transmit without
 * the plaintext crossing IPC).
 *
 * Why this exists. The `to:ai:key:set` IPC payload used to carry the
 * raw provider API key as a string — compliance flagged it: key
 * material must not cross the renderer ↔ main IPC boundary in
 * plaintext, even though the boundary is in-process. `safeStorage`
 * (the obvious tool) is a main-process module and isn't accessible
 * to preload / renderer, so we can't symmetric-encrypt at the
 * renderer side without first leaking a session key. Asymmetric
 * crypto sidesteps that: main owns the private key, the renderer
 * encrypts with the public key, only ciphertext crosses IPC.
 *
 * Mechanism. On instantiation we generate an ephemeral 2048-bit
 * RSA-OAEP keypair (SHA-256 hash). The public key is exported as
 * SPKI base64 — that's the only artefact the renderer ever sees —
 * and consumed via Web Crypto in the renderer (`crypto.subtle.
 * importKey`). The private key never leaves this process, never
 * touches disk, never serialises.
 *
 * Lifecycle. The keypair is regenerated every app launch — there's
 * no persistence requirement (the secrets it protects are
 * encrypted at rest by `safeStorage` separately). A future window
 * recreation reuses the same SecureChannel instance via the
 * existing AppBridge singleton, so the renderer's cached public
 * key stays valid for the app session.
 */
export class SecureChannel {
  private readonly privateKey: KeyObject;
  /** SPKI export of the public key — base64-encoded for transport. */
  public readonly publicKeySpkiBase64: string;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    this.privateKey = privateKey;
    this.publicKeySpkiBase64 = publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('base64');
  }

  /**
   * Decrypt an RSA-OAEP-SHA-256 ciphertext (base64) produced by the
   * renderer's Web Crypto encrypt call. Returns the plaintext as a
   * UTF-8 string. Throws on any padding / key mismatch — callers
   * should treat that as a tampered or malformed payload and refuse
   * to act on it.
   *
   * The plaintext exists in this process's memory only as long as
   * the immediate caller's stack frame; the recommended pattern is
   * decrypt → safeStorage.encryptString → write → drop the
   * reference. (Node can't zero a string in place, but the GC will
   * reclaim it; in-process plaintext is the same risk surface
   * safeStorage already accepts.)
   */
  decryptString(ciphertextBase64: string): string {
    if (!ciphertextBase64 || typeof ciphertextBase64 !== 'string') {
      throw new Error('SecureChannel.decryptString: missing ciphertext');
    }
    const ciphertext = Buffer.from(ciphertextBase64, 'base64');
    const plaintext = privateDecrypt(
      {
        key: this.privateKey,
        padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      ciphertext,
    );
    return plaintext.toString('utf-8');
  }
}
