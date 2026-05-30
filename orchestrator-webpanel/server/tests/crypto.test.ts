import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../src/services/crypto/aes';

describe('AES-GCM crypto', () => {
  const KEY = 'unit-test-master-key-do-not-use-in-prod';

  it('round-trips a plaintext string', () => {
    const plain = 'super-secret-value-42';
    const { ciphertext, iv, tag } = encrypt(plain, KEY);
    expect(decrypt(ciphertext, iv, KEY, tag)).toBe(plain);
  });

  it('produces a different ciphertext for the same plaintext (random IV)', () => {
    const a = encrypt('same-plain', KEY);
    const b = encrypt('same-plain', KEY);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('refuses decryption with the wrong key (auth tag fails)', () => {
    const { ciphertext, iv, tag } = encrypt('payload', KEY);
    expect(() => decrypt(ciphertext, iv, 'different-key', tag)).toThrow();
  });

  it('refuses decryption with a tampered ciphertext', () => {
    const { ciphertext, iv, tag } = encrypt('payload', KEY);
    const tampered = ciphertext.slice(0, -2) + (ciphertext.endsWith('0') ? '11' : '00');
    expect(() => decrypt(tampered, iv, KEY, tag)).toThrow();
  });

  it('handles UTF-8 bytes correctly', () => {
    const plain = 'éàü 中文 🚀';
    const { ciphertext, iv, tag } = encrypt(plain, KEY);
    expect(decrypt(ciphertext, iv, KEY, tag)).toBe(plain);
  });
});
