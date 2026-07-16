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

// --- TOTP (RFC 6238) for optional two-factor auth: base32 secret, 30s step, 6 digits. ---
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function randomTotpSecret(): string {
  let out = '';
  for (const b of randomBytes(20)) out += B32[b % 32];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(buf).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

/** Verify a 6-digit TOTP within ±1 step (±30s) of now. */
export function verifyTotp(secret: string, code: string, nowMs: number): boolean {
  const c = code.replace(/\D/g, '');
  if (c.length !== 6) return false;
  const key = base32Decode(secret);
  const step = Math.floor(nowMs / 1000 / 30);
  for (let w = -1; w <= 1; w++) {
    const expected = Buffer.from(hotp(key, step + w));
    if (expected.length === c.length && timingSafeEqual(expected, Buffer.from(c))) return true;
  }
  return false;
}

/** The current 6-digit TOTP code for a secret — what an authenticator app would show. */
export function totpCode(secret: string, nowMs: number): string {
  return hotp(base32Decode(secret), Math.floor(nowMs / 1000 / 30));
}

/** otpauth:// URI for authenticator-app setup (QR or manual entry). */
export function totpUri(secret: string, account: string, issuer = 'BaseDesk'): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}
