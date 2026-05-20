/**
 * SecureChannel — main-side counterpart to the renderer's
 * SecureChannelClient. Compliance-critical: it must decrypt
 * RSA-OAEP-SHA-256 ciphertext produced from its own public key.
 * Tests round-trip with Node's `crypto.publicEncrypt` standing in
 * for the renderer's Web Crypto so we're not coupled to a browser
 * env here.
 */

import {
  publicEncrypt,
  constants as cryptoConstants,
  createPublicKey,
} from 'crypto';

import { SecureChannel } from '../src/app/lib/SecureChannel';

describe('SecureChannel', () => {
  it('round-trips: ciphertext encrypted with the published public key decrypts to the original plaintext', () => {
    const ch = new SecureChannel();
    const pubKey = createPublicKey({
      key: Buffer.from(ch.publicKeySpkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const plaintext = 'sk-ant-this-is-a-test-key-1234567890';
    const cipher = publicEncrypt(
      {
        key: pubKey,
        padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(plaintext, 'utf-8'),
    );
    const result = ch.decryptString(cipher.toString('base64'));
    expect(result).toBe(plaintext);
  });

  it('throws on a malformed / tampered ciphertext (never silently returns garbage)', () => {
    const ch = new SecureChannel();
    expect(() => ch.decryptString('not-real-ciphertext')).toThrow();
  });

  it('throws on an empty payload (compliance gate refuses to act on a missing secret)', () => {
    const ch = new SecureChannel();
    expect(() => ch.decryptString('')).toThrow(/missing ciphertext/);
  });

  it('two SecureChannel instances are mutually incompatible (per-session keypair = fresh secrets per app launch)', () => {
    // Cross-instance decrypt MUST fail — pins the per-session
    // property that justifies regenerating on every launch.
    const a = new SecureChannel();
    const b = new SecureChannel();
    const pubA = createPublicKey({
      key: Buffer.from(a.publicKeySpkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const cipher = publicEncrypt(
      {
        key: pubA,
        padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from('secret', 'utf-8'),
    );
    expect(() => b.decryptString(cipher.toString('base64'))).toThrow();
  });
});
