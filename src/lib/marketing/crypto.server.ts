import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function getEncryptionKey() {
  const secret = process.env.MARKETING_TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('Brak konfiguracji MARKETING_TOKEN_ENCRYPTION_KEY.');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptMarketingCredentials(value: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptMarketingCredentials<T = Record<string, unknown>>(value: string): T {
  const [version, ivValue, tagValue, encryptedValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Nieprawidłowy format zaszyfrowanych danych integracji.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}
