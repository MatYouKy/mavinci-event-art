import 'server-only';
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';

/*
 * Linki do pobrania z Materiałów: token w adresie, hasło (skrót scrypt — w bazie nie ma samego hasła), klucz sesji
 * w ciasteczku odbiorcy (w bazie tylko skrót SHA-256). Wszystko z `node:crypto`, bez dodatkowych pakietów.
 */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;
/** Hasło do podyktowania przez telefon: bez znaków mylących (0/O, 1/l/I). */
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const SHARE_TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

/** Token adresu linku: 32 losowe bajty (base64url, 43 znaki). */
export const newShareToken = () => randomBytes(32).toString('base64url');

/** Klucz sesji odbiorcy (ciasteczko) — w bazie tylko jego skrót. */
export const newSessionKey = () => randomBytes(32).toString('base64url');

export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

/** Hasło generowane: 10 znaków w dwóch grupach („Kx7pm-2Qa9T”). */
export function generateSharePassword() {
  const pick = () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  const group = () => Array.from({ length: 5 }, pick).join('');
  return `${group()}-${group()}`;
}

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Skrót hasła: `scrypt$N$r$p$sól$skrót` (base64url). */
export async function hashSharePassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** Hasło zgodne ze skrótem (porównanie w stałym czasie); zły format — `false`. */
export async function verifySharePassword(password: string, stored: string | null | undefined) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 1 << 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (!salt.length || expected.length < 16 || expected.length > 64) return false;
  const key = await derive(password, salt, N, r, p, expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Nazwa ciasteczka sesji linku (z tokenu — bez sięgania do bazy). */
export const shareCookieName = (token: string) => `mvs_${sha256Hex(`share:${token}`).slice(0, 16)}`;
