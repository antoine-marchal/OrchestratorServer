import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;

function deriveKey(masterKey: string): Buffer {
  return crypto.scryptSync(masterKey, 'orchestrator-salt', KEY_LENGTH);
}

export function encrypt(plaintext: string, masterKey: string): { ciphertext: string; iv: string; tag: string } {
  const key = deriveKey(masterKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

export function decrypt(ciphertext: string, iv: string, masterKey: string, tag?: string): string {
  const key = deriveKey(masterKey);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  if (tag) decipher.setAuthTag(Buffer.from(tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function getMasterKey(): string {
  const key = process.env.ORCHESTRATOR_MASTER_KEY;
  if (!key) {
    console.warn('[Crypto] ORCHESTRATOR_MASTER_KEY not set; using default dev key. Set this in production!');
    return 'orchestrator-default-dev-key-change-in-prod';
  }
  return key;
}
