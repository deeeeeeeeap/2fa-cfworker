/*
 * Standalone RFC 6238 vector check. Run with: node scripts/check-vectors.mjs
 *
 * This is an INDEPENDENT reference implementation: it imports nothing from
 * src/ and re-implements Base32 decoding, HOTP, and TOTP from scratch. It
 * exists to cross-validate the RFC 6238 test vectors against the product
 * code — two separately written implementations must both reproduce the
 * official vectors, so a bug shared by the product code and its tests cannot
 * pass unnoticed. Vector tests that exercise the product code itself live in
 * tests/totp.test.ts.
 */
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const hashName = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };
function base32ToBytes(input) {
  const s = input.replace(/[\s-]/g, '').replace(/=+$/g, '').toUpperCase();
  let buffer = 0, bitsLeft = 0, out = [];
  for (const ch of s) {
    const value = alphabet.indexOf(ch);
    if (value < 0) throw new Error('Invalid Base32');
    buffer = (buffer << 5) | value;
    bitsLeft += 5;
    while (bitsLeft >= 8) {
      out.push((buffer >> (bitsLeft - 8)) & 255);
      bitsLeft -= 8;
    }
  }
  return new Uint8Array(out);
}
function counterToBytes(counter) {
  const bytes = new Uint8Array(8);
  let v = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    bytes[i] = Number(v & 255n);
    v >>= 8n;
  }
  return bytes;
}
async function hotp(key, counter, digits, algorithm) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: { name: hashName[algorithm] } }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterToBytes(counter)));
  const offset = sig[sig.length - 1] & 15;
  const bin = ((sig[offset] & 127) * 2 ** 24) + ((sig[offset + 1] & 255) << 16) + ((sig[offset + 2] & 255) << 8) + (sig[offset + 3] & 255);
  return String(bin % 10 ** digits).padStart(digits, '0');
}
async function totp(secret, timeSeconds) {
  return hotp(base32ToBytes(secret), BigInt(Math.floor(timeSeconds / 30)), 8, 'SHA1');
}
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const cases = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
let failed = false;
for (const [time, expected] of cases) {
  const actual = await totp(secret, time);
  const ok = actual === expected;
  console.log(`${time}: ${actual} expected ${expected} ${ok ? 'OK' : 'FAIL'}`);
  failed ||= !ok;
}
process.exit(failed ? 1 : 0);
