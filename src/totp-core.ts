/**
 * Pure TOTP/HOTP core shared by the Worker routes and tests.
 *
 * This module has no HTTP or DOM dependencies. Validation failures throw
 * TotpError; transport layers (HTTP routes, UI) map it onto their own
 * error/status vocabulary.
 *
 * Security rule: never log request URLs, request bodies, or decoded secrets.
 */

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export type TotpOptions = {
  period?: number;
  digits?: number;
  algorithm?: TotpAlgorithm;
  timestampMs?: number;
  t0?: number;
};

export type RawTotpOptions = {
  period?: unknown;
  digits?: unknown;
  algorithm?: unknown;
  timestampMs?: unknown;
  time?: unknown;
  t0?: unknown;
};

export type TotpResult = {
  token: string;
  period: number;
  remaining: number;
  remainingMs: number;
  validUntil: string;
  digits: number;
  algorithm: TotpAlgorithm;
  counter: string;
};

export type ByteArray = Uint8Array<ArrayBuffer>;

export const DEFAULT_PERIOD = 30;
export const DEFAULT_DIGITS = 6;
export const DEFAULT_ALGORITHM: TotpAlgorithm = "SHA1";
export const DEFAULT_T0 = 0;
export const MIN_PERIOD = 5;
export const MAX_PERIOD = 300;
export const MIN_DIGITS = 6;
export const MAX_DIGITS = 8;
export const MAX_SECRET_LENGTH = 256;
export const MAX_UNIX_SECONDS = 20000000000;
const MIN_T0 = 0;

export const HASH_NAME: Record<TotpAlgorithm, string> = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA512: "SHA-512",
};

export const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export type TotpErrorKind = "invalid" | "too_long";

export class TotpError extends Error {
  readonly kind: TotpErrorKind;

  constructor(message: string, kind: TotpErrorKind = "invalid") {
    super(message);
    this.kind = kind;
  }
}

export function normalizeBase32(input: unknown): string {
  if (typeof input !== "string") {
    throw new TotpError("secret must be a Base32 string");
  }

  let secret = input.trim();
  if (secret.includes("%")) {
    try {
      secret = decodeURIComponent(secret);
    } catch {
      throw new TotpError("secret contains invalid percent-encoding");
    }
  }

  secret = secret.replace(/[\s-]/g, "").replace(/=+$/g, "").toUpperCase();

  if (secret.length === 0) {
    throw new TotpError("secret is required");
  }
  if (secret.length > MAX_SECRET_LENGTH) {
    throw new TotpError("secret is too long", "too_long");
  }
  if (!/^[A-Z2-7]+$/.test(secret)) {
    throw new TotpError("secret must use RFC 4648 Base32 characters A-Z and 2-7");
  }

  return secret;
}

export function base32ToBytes(input: string): ByteArray {
  const secret = normalizeBase32(input);
  let buffer = 0;
  let bitsLeft = 0;
  const out: number[] = [];

  for (const char of secret) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new TotpError("invalid Base32 secret");
    }

    buffer = (buffer << 5) | value;
    bitsLeft += 5;

    while (bitsLeft >= 8) {
      out.push((buffer >> (bitsLeft - 8)) & 0xff);
      bitsLeft -= 8;
    }
  }

  if (out.length === 0) {
    throw new TotpError("secret decodes to an empty key");
  }

  return new Uint8Array(out);
}

function parseInteger(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) {
    throw new TotpError(`${name} must be an integer between ${min} and ${max}`);
  }
  return numberValue;
}

function parseAlgorithm(value: unknown): TotpAlgorithm {
  if (value === undefined || value === null || value === "") return DEFAULT_ALGORITHM;
  const normalized = String(value).replace(/-/g, "").toUpperCase();
  if (normalized === "SHA1" || normalized === "SHA256" || normalized === "SHA512") {
    return normalized as TotpAlgorithm;
  }
  throw new TotpError("algorithm must be SHA1, SHA256, or SHA512");
}

export function normalizeTotpOptions(data: RawTotpOptions = {}): Required<TotpOptions> {
  const period = parseInteger(data.period, DEFAULT_PERIOD, MIN_PERIOD, MAX_PERIOD, "period");
  const digits = parseInteger(data.digits, DEFAULT_DIGITS, MIN_DIGITS, MAX_DIGITS, "digits");
  const t0 = parseInteger(data.t0, DEFAULT_T0, MIN_T0, MAX_UNIX_SECONDS, "t0");
  const algorithm = parseAlgorithm(data.algorithm);

  let timestampMs = Date.now();
  if (data.timestampMs !== undefined && data.timestampMs !== null && data.timestampMs !== "") {
    const milliseconds = Number(data.timestampMs);
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > MAX_UNIX_SECONDS * 1000) {
      throw new TotpError("timestampMs must be a Unix timestamp in milliseconds");
    }
    timestampMs = Math.floor(milliseconds);
  } else if (data.time !== undefined && data.time !== null && data.time !== "") {
    const seconds = Number(data.time);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_UNIX_SECONDS) {
      throw new TotpError("time must be a Unix timestamp in seconds");
    }
    timestampMs = Math.floor(seconds * 1000);
  }

  return { period, digits, t0, algorithm, timestampMs };
}

export function counterToBytes(counter: bigint): ByteArray {
  const bytes = new Uint8Array(8);
  let value = counter;
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

export async function hotp(key: ByteArray, counter: bigint, digits: number, algorithm: TotpAlgorithm): Promise<string> {
  // Deliberately not cached: re-importing per call keeps secret-derived
  // CryptoKey objects out of long-lived isolate memory. Do not "optimize"
  // this into a module-level cache.
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: { name: HASH_NAME[algorithm] } },
    false,
    ["sign"],
  );

  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counterToBytes(counter)));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) * 2 ** 24) +
    ((signature[offset + 1] & 0xff) << 16) +
    ((signature[offset + 2] & 0xff) << 8) +
    (signature[offset + 3] & 0xff);

  const modulo = 10 ** digits;
  return String(binary % modulo).padStart(digits, "0");
}

export async function generateTotp(secret: string, options: RawTotpOptions = {}): Promise<TotpResult> {
  const { period, digits, algorithm, t0, timestampMs } = normalizeTotpOptions(options);
  const unixSeconds = Math.floor(timestampMs / 1000);

  if (unixSeconds < t0) {
    throw new TotpError("time must be greater than or equal to t0");
  }

  const key = base32ToBytes(secret);
  const counter = BigInt(Math.floor((unixSeconds - t0) / period));
  const token = await hotp(key, counter, digits, algorithm);
  const elapsed = (unixSeconds - t0) % period;
  const remaining = period - elapsed;
  const elapsedMs = (timestampMs - t0 * 1000) % (period * 1000);
  const remainingMs = period * 1000 - elapsedMs;

  return {
    token,
    period,
    remaining,
    remainingMs,
    validUntil: new Date(timestampMs + remainingMs).toISOString(),
    digits,
    algorithm,
    counter: counter.toString(),
  };
}
