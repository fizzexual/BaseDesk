// Password hashing and portal session tokens — all with Node's built-in crypto,
// no dependencies. Passwords are scrypt-hashed with a per-user salt (never stored
// in plaintext); sessions are stateless HMAC-signed tokens over the contact id.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** `salt:hash`, hex-encoded. scrypt is a slow KDF, which is what we want here. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, 64);
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** `${contactId}.${hmac}` — verifiable without server-side session storage. */
export function signSession(secret: string, contactId: string): string {
  const sig = createHmac('sha256', secret).update(contactId).digest('hex');
  return `${contactId}.${sig}`;
}

export function verifySession(secret: string, token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const contactId = token.slice(0, dot);
  const expected = signSession(secret, contactId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? contactId : null;
}
