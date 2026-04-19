import { createHmac, randomBytes } from 'node:crypto';

// Minimal RFC 6238 TOTP / RFC 4648 Base32 implementation — no extra deps.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += '=';
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function totp(secretB32: string, time: number = Math.floor(Date.now() / 1000), opts?: { period?: number; digits?: number; algorithm?: string }) {
  const period = opts?.period ?? 30;
  const digits = opts?.digits ?? 6;
  const algorithm = (opts?.algorithm ?? 'sha1').toLowerCase();
  const counter = Math.floor(time / period);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const key = base32Decode(secretB32);
  const hmac = createHmac(algorithm, key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  const code = (bin % 10 ** digits).toString().padStart(digits, '0');
  return code;
}

export function verifyTotp(secretB32: string, code: string, window = 1): boolean {
  const now = Math.floor(Date.now() / 1000);
  for (let w = -window; w <= window; w++) {
    if (totp(secretB32, now + w * 30) === code) return true;
  }
  return false;
}

export function otpauthUrl(params: { secret: string; label: string; issuer: string; digits?: number; period?: number; algorithm?: string }): string {
  const q = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: (params.algorithm || 'SHA1').toUpperCase(),
    digits: String(params.digits ?? 6),
    period: String(params.period ?? 30),
  });
  return `otpauth://totp/${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.label)}?${q.toString()}`;
}
