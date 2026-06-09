/**
 * Cloudflare Worker TOTP generator.
 *
 * Intended use:
 * - Serve a local-browser TOTP UI at GET /
 * - Provide a 2fa.live-like compatibility endpoint at GET /tok/:base32Secret
 * - Provide safer API variants at /api/totp, preferably POST instead of putting secrets in URLs.
 *
 * Security rule: never log request URLs, request bodies, or decoded secrets.
 */

type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

type TotpOptions = {
  period?: number;
  digits?: number;
  algorithm?: TotpAlgorithm;
  timestampMs?: number;
  t0?: number;
};

type RawTotpOptions = {
  period?: unknown;
  digits?: unknown;
  algorithm?: unknown;
  timestampMs?: unknown;
  time?: unknown;
  t0?: unknown;
};

type TotpResult = {
  token: string;
  period: number;
  remaining: number;
  digits: number;
  algorithm: TotpAlgorithm;
  counter: string;
};

type ByteArray = Uint8Array<ArrayBuffer>;

const DEFAULT_PERIOD = 30;
const DEFAULT_DIGITS = 6;
const DEFAULT_ALGORITHM: TotpAlgorithm = "SHA1";
const DEFAULT_T0 = 0;
const MIN_PERIOD = 5;
const MAX_PERIOD = 300;
const MIN_DIGITS = 6;
const MAX_DIGITS = 8;
const MAX_SECRET_LENGTH = 256;
const MAX_UNIX_SECONDS = 20000000000;
const MAX_JSON_BODY_BYTES = 2048;

const HASH_NAME: Record<TotpAlgorithm, string> = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA512: "SHA-512",
};
const GITHUB_REPOSITORY_URL = "https://github.com/deeeeeeeeap/2fa-cfworker";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const COMMON_HEADERS: Record<string, string> = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy": "clipboard-write=(self)",
};

function securityHeaders(contentType: string, cacheControl: string, nonce?: string): Headers {
  const headers = new Headers(COMMON_HEADERS);
  headers.set("Cache-Control", cacheControl);
  headers.set("Content-Type", contentType);
  if (cacheControl.includes("no-store")) {
    headers.set("Pragma", "no-cache");
  }
  if (contentType.startsWith("text/html")) {
    const scriptPolicy = nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'";
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        scriptPolicy,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join("; "),
    );
  }
  return headers;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: securityHeaders("application/json; charset=utf-8", "no-store, max-age=0"),
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: securityHeaders("text/plain; charset=utf-8", "public, max-age=300"),
  });
}

function htmlResponse(body: string, nonce: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: securityHeaders("text/html; charset=utf-8", "public, max-age=300, must-revalidate", nonce),
  });
}

function normalizeBase32(input: unknown): string {
  if (typeof input !== "string") {
    throw new HttpError(400, "secret must be a Base32 string");
  }

  let secret = input.trim();
  if (secret.includes("%")) {
    try {
      secret = decodeURIComponent(secret);
    } catch {
      throw new HttpError(400, "secret contains invalid percent-encoding");
    }
  }

  secret = secret.replace(/[\s-]/g, "").replace(/=+$/g, "").toUpperCase();

  if (secret.length === 0) {
    throw new HttpError(400, "secret is required");
  }
  if (secret.length > MAX_SECRET_LENGTH) {
    throw new HttpError(413, "secret is too long");
  }
  if (!/^[A-Z2-7]+$/.test(secret)) {
    throw new HttpError(400, "secret must use RFC 4648 Base32 characters A-Z and 2-7");
  }

  return secret;
}

function base32ToBytes(input: string): ByteArray {
  const secret = normalizeBase32(input);
  let buffer = 0;
  let bitsLeft = 0;
  const out: number[] = [];

  for (const char of secret) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new HttpError(400, "invalid Base32 secret");
    }

    buffer = (buffer << 5) | value;
    bitsLeft += 5;

    while (bitsLeft >= 8) {
      out.push((buffer >> (bitsLeft - 8)) & 0xff);
      bitsLeft -= 8;
    }
  }

  if (out.length === 0) {
    throw new HttpError(400, "secret decodes to an empty key");
  }

  return new Uint8Array(out);
}

function parseInteger(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) {
    throw new HttpError(400, `${name} must be an integer between ${min} and ${max}`);
  }
  return numberValue;
}

function parseAlgorithm(value: unknown): TotpAlgorithm {
  if (value === undefined || value === null || value === "") return DEFAULT_ALGORITHM;
  const normalized = String(value).replace(/-/g, "").toUpperCase();
  if (normalized === "SHA1" || normalized === "SHA256" || normalized === "SHA512") {
    return normalized as TotpAlgorithm;
  }
  throw new HttpError(400, "algorithm must be SHA1, SHA256, or SHA512");
}

function normalizeTotpOptions(data: RawTotpOptions = {}): Required<TotpOptions> {
  const period = parseInteger(data.period, DEFAULT_PERIOD, MIN_PERIOD, MAX_PERIOD, "period");
  const digits = parseInteger(data.digits, DEFAULT_DIGITS, MIN_DIGITS, MAX_DIGITS, "digits");
  const t0 = parseInteger(data.t0, DEFAULT_T0, DEFAULT_T0, MAX_UNIX_SECONDS, "t0");
  const algorithm = parseAlgorithm(data.algorithm);

  let timestampMs = Date.now();
  if (data.timestampMs !== undefined && data.timestampMs !== null && data.timestampMs !== "") {
    const milliseconds = Number(data.timestampMs);
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > MAX_UNIX_SECONDS * 1000) {
      throw new HttpError(400, "timestampMs must be a Unix timestamp in milliseconds");
    }
    timestampMs = Math.floor(milliseconds);
  } else if (data.time !== undefined && data.time !== null && data.time !== "") {
    const seconds = Number(data.time);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_UNIX_SECONDS) {
      throw new HttpError(400, "time must be a Unix timestamp in seconds");
    }
    timestampMs = Math.floor(seconds * 1000);
  }

  return { period, digits, t0, algorithm, timestampMs };
}

function parseOptionsFromObject(data: Record<string, unknown>): Required<TotpOptions> {
  return normalizeTotpOptions(data);
}

function parseOptionsFromSearchParams(params: URLSearchParams): Required<TotpOptions> {
  return normalizeTotpOptions({
    period: params.get("period") ?? undefined,
    digits: params.get("digits") ?? undefined,
    algorithm: params.get("algorithm") ?? undefined,
    t0: params.get("t0") ?? undefined,
    time: params.get("time") ?? undefined,
  });
}

function counterToBytes(counter: bigint): ByteArray {
  const bytes = new Uint8Array(8);
  let value = counter;
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

async function hotp(key: ByteArray, counter: bigint, digits: number, algorithm: TotpAlgorithm): Promise<string> {
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

async function generateTotp(secret: string, options: TotpOptions = {}): Promise<TotpResult> {
  const { period, digits, algorithm, t0, timestampMs } = normalizeTotpOptions(options);
  const unixSeconds = Math.floor(timestampMs / 1000);

  if (unixSeconds < t0) {
    throw new HttpError(400, "time must be greater than or equal to t0");
  }

  const key = base32ToBytes(secret);
  const counter = BigInt(Math.floor((unixSeconds - t0) / period));
  const token = await hotp(key, counter, digits, algorithm);
  const elapsed = (unixSeconds - t0) % period;
  const remaining = period - elapsed;

  return {
    token,
    period,
    remaining,
    digits,
    algorithm,
    counter: counter.toString(),
  };
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const PAGE_CSS = `
:root {
  color: #0f1b35;
  background:
    radial-gradient(circle at 10% 22%, rgba(37, 99, 235, .07), transparent 18%),
    radial-gradient(circle at 88% 20%, rgba(37, 99, 235, .08), transparent 19%),
    linear-gradient(180deg, #ffffff 0%, #f8fbff 45%, #ffffff 100%);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
}
main,
section,
div {
  min-width: 0;
}
button,
input,
select {
  font: inherit;
}
button {
  cursor: pointer;
}
.page {
  min-height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(circle at 14% 25%, rgba(84, 154, 255, .10), transparent 15%),
    radial-gradient(circle at 88% 26%, rgba(84, 154, 255, .12), transparent 16%);
}
.shell {
  width: min(1184px, calc(100vw - 48px));
  margin: 0 auto;
}
.topbar {
  height: 82px;
  border-bottom: 1px solid #e6edf8;
  background: rgba(255, 255, 255, .86);
  backdrop-filter: blur(12px);
}
.topbar-inner {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -.03em;
}
.brand strong {
  color: #1673f5;
}
.brand span:last-child {
  color: #0b1a45;
}
.shield-logo,
.hero-shield,
.result-shield {
  display: inline-grid;
  place-items: center;
  color: #fff;
  background: linear-gradient(180deg, #2e86ff, #0f5fe8);
  box-shadow: 0 12px 26px rgba(18, 109, 237, .25);
  clip-path: polygon(50% 0, 88% 16%, 88% 54%, 50% 100%, 12% 54%, 12% 16%);
}
.shield-logo {
  width: 34px;
  height: 38px;
  font-size: 18px;
}
.nav {
  display: flex;
  align-items: center;
  gap: 28px;
  color: #081a45;
  font-weight: 700;
}
.nav a {
  color: inherit;
  text-decoration: none;
  white-space: nowrap;
}
.nav a:hover,
.nav a:focus-visible {
  color: #1268ee;
}
.lang {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid #cfdcf1;
  border-radius: 8px;
  background: #fff;
}
.lang button {
  min-width: 58px;
  border: 0;
  padding: 9px 16px;
  background: transparent;
  color: #0b1b3d;
  font-weight: 800;
}
.lang .active {
  background: #1268ee;
  color: #fff;
}
.github {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  border-radius: 7px;
  line-height: 1;
}
.hero {
  position: relative;
  min-height: 220px;
  padding: 66px 230px 22px;
  overflow: hidden;
  isolation: isolate;
  text-align: center;
}
.hero h1 {
  position: relative;
  z-index: 1;
  margin: 0;
  font-size: clamp(34px, 4.5vw, 48px);
  line-height: 1.08;
  color: #101a33;
  letter-spacing: -.045em;
  font-weight: 900;
}
.hero p {
  position: relative;
  z-index: 1;
  margin: 17px 0 0;
  color: #40516f;
  font-size: 18px;
  line-height: 1.55;
}
.hero-art {
  position: absolute;
  z-index: 0;
  pointer-events: none;
  opacity: .95;
}
.hero-art.left {
  left: -28px;
  top: 55px;
  width: 280px;
  height: 150px;
}
.hero-art.right {
  right: -8px;
  top: 72px;
  width: 270px;
  height: 130px;
}
.dots {
  position: absolute;
  left: 0;
  bottom: 15px;
  width: 116px;
  height: 76px;
  background-image: radial-gradient(#8cc3ff 1.6px, transparent 1.8px);
  background-size: 12px 12px;
  opacity: .7;
}
.cloud {
  position: absolute;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(230, 242, 255, .96), rgba(205, 228, 252, .72));
}
.cloud.c1 { width: 190px; height: 58px; left: 84px; bottom: 12px; }
.cloud.c2 { width: 86px; height: 86px; left: 162px; bottom: 20px; }
.cloud.c3 { width: 124px; height: 124px; left: 196px; bottom: -18px; }
.hero-shield {
  position: absolute;
  left: 78px;
  top: 16px;
  width: 70px;
  height: 82px;
  font-size: 32px;
}
.globe {
  position: absolute;
  right: 72px;
  top: 4px;
  width: 112px;
  height: 92px;
  border-radius: 66px 66px 0 0;
  background:
    linear-gradient(90deg, transparent 32%, rgba(255,255,255,.85) 33%, rgba(255,255,255,.85) 34%, transparent 35%, transparent 64%, rgba(255,255,255,.85) 65%, rgba(255,255,255,.85) 66%, transparent 67%),
    linear-gradient(180deg, #8dbbff, #5b96f0);
}
.globe::before,
.globe::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: rgba(255,255,255,.8);
}
.globe::before { top: 32px; }
.globe::after { top: 62px; }
.orange-cloud {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 105px;
  height: 31px;
  border-radius: 999px;
  background: #f28a0a;
  box-shadow: -32px 5px 0 -2px #f28a0a, 23px 8px 0 -6px #f28a0a;
}
.orange-cloud::before,
.orange-cloud::after {
  content: "";
  position: absolute;
  border-radius: 50%;
  background: #f28a0a;
}
.orange-cloud::before { width: 48px; height: 48px; left: 13px; top: -26px; }
.orange-cloud::after { width: 33px; height: 33px; right: 12px; top: -13px; }
.main-grid {
  display: grid;
  grid-template-columns: 1.22fr .88fr;
  gap: 14px;
  margin-top: 18px;
}
.panel,
.feature,
.warning {
  border: 1px solid #dde7f5;
  background: rgba(255, 255, 255, .92);
  box-shadow: 0 16px 45px rgba(15, 42, 92, .09);
}
.panel {
  border-radius: 12px;
  padding: 22px;
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  color: #111b34;
  font-size: 20px;
  font-weight: 900;
}
.blue-icon,
.feature-icon {
  color: #1268ee;
  font-weight: 900;
}
.field {
  margin-top: 14px;
}
.field label {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 7px;
  color: #23314f;
  font-weight: 800;
}
.help {
  display: inline-grid;
  width: 17px;
  height: 17px;
  place-items: center;
  border: 1px solid #a7b7d3;
  border-radius: 50%;
  color: #71809a;
  font-size: 12px;
}
.input-wrap {
  position: relative;
}
.input-wrap input {
  width: 100%;
  min-width: 0;
  height: 39px;
  border: 1px solid #cdd8ea;
  border-radius: 6px;
  padding: 0 44px 0 14px;
  color: #101827;
  background: #fff;
  outline: none;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, .03);
  text-overflow: ellipsis;
}
.input-wrap input::placeholder {
  color: #8b9ab1;
}
.input-wrap input:focus {
  border-color: #2f7df2;
  box-shadow: 0 0 0 3px rgba(47, 125, 242, .16);
}
.icon-button {
  position: absolute;
  right: 8px;
  top: 7px;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #52617a;
  font-size: 18px;
}
.primary {
  width: 100%;
  height: 39px;
  margin-top: 14px;
  border: 0;
  border-radius: 6px;
  color: #fff;
  background: linear-gradient(180deg, #1973fa, #075de8);
  box-shadow: 0 9px 20px rgba(12, 100, 232, .24);
  font-weight: 900;
}
.result-card {
  margin-top: 1px;
  overflow: hidden;
  border: 1px solid #d9e3f1;
  border-radius: 8px;
  background: linear-gradient(180deg, #f8fbff, #ffffff);
}
.result-main {
  min-height: 116px;
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) 96px;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
}
.result-shield {
  width: 62px;
  height: 70px;
  margin-left: 8px;
  font-size: 31px;
  color: #1268ee;
  background: #edf6ff;
  box-shadow: none;
}
.token {
  text-align: center;
  color: #1f6fe8;
  font-size: clamp(42px, 4.8vw, 64px);
  line-height: 1;
  font-weight: 900;
  letter-spacing: .12em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.timer {
  justify-self: end;
  width: 78px;
  height: 78px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: conic-gradient(#1268ee var(--progress, 25%), #e5e9ef 0);
}
.timer-inner {
  width: 62px;
  height: 62px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #fff;
  color: #0f172a;
  font-weight: 900;
  line-height: 1.08;
}
.timer-value {
  font-size: 15px;
  font-weight: 900;
}
.timer-inner span {
  display: block;
  font-size: 11px;
  font-weight: 800;
}
.result-meta {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 1.45fr) minmax(0, .72fr) minmax(0, .56fr) minmax(0, .68fr);
  border-top: 1px solid #d9e3f1;
  border-bottom: 1px solid #d9e3f1;
}
.meta-cell {
  display: flex;
  min-width: 0;
  min-height: 52px;
  flex-direction: column;
  justify-content: center;
  padding: 10px 14px;
  border-right: 1px solid #e1e7f0;
  color: #17233d;
}
.meta-cell:last-child {
  border-right: 0;
}
.meta-cell strong {
  display: block;
  margin-bottom: 3px;
  color: #52617a;
  font-size: 13px;
}
.meta-cell strong,
.meta-cell span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.next {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: #42516d;
  font-size: 14px;
  line-height: 1;
  white-space: nowrap;
}
.next b {
  color: #1268ee;
  font-size: 16px;
}
.api-desc {
  color: #263854;
  line-height: 1.6;
  margin: 0 0 18px;
}
.code-box {
  position: relative;
  margin-top: 10px;
  border-radius: 6px;
  padding: 20px 18px;
  min-height: 126px;
  color: #d6e1ef;
  background: linear-gradient(180deg, #101826, #08111f);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .05);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}
.code-line {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  line-height: 1.7;
}
.code-line span:first-child {
  color: #8ca0bb;
}
.code-line span:last-child {
  min-width: 0;
  overflow-wrap: anywhere;
}
.green {
  color: #5ee874;
}
.api-note-box {
  display: flex;
  gap: 10px;
  margin-top: 18px;
  border: 1px solid #bcd9ff;
  border-radius: 6px;
  padding: 13px 15px;
  color: #40516f;
  background: #f4f9ff;
  line-height: 1.5;
}
.feature-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}
.feature {
  min-height: 96px;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  border-radius: 8px;
  padding: 16px 18px;
}
.feature-icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: #edf6ff;
  font-size: 28px;
  line-height: 1;
}
.feature h3 {
  margin: 0 0 4px;
  font-size: 15px;
  color: #17233d;
}
.feature p {
  margin: 0;
  color: #40516f;
  font-size: 13px;
  line-height: 1.45;
}
.feature.orange .feature-icon {
  color: #f28a0a;
  background: #fff4e5;
}
.warning {
  display: flex;
  align-items: center;
  gap: 20px;
  min-height: 75px;
  margin-top: 14px;
  border-color: #f7c879;
  border-radius: 8px;
  padding: 14px 24px;
  color: #9a3f07;
  background: linear-gradient(90deg, #fff8e9, #fffdfa);
  box-shadow: none;
}
.warning-mark {
  color: #d97706;
  font-size: 42px;
  line-height: 1;
}
.warning strong {
  display: block;
  margin-bottom: 4px;
  font-size: 19px;
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 18px 0 22px;
  padding-top: 13px;
  border-top: 1px solid #dde7f5;
  color: #40516f;
  font-size: 13px;
}
.footer a {
  color: #23314f;
  text-decoration: none;
  font-weight: 700;
}
.footer-links {
  display: flex;
  gap: 30px;
}
@media (max-width: 960px) {
  .hero-art { display: none; }
  .hero {
    min-height: 0;
    padding-inline: 0;
  }
  .main-grid,
  .feature-grid {
    grid-template-columns: 1fr;
  }
  .result-main {
    grid-template-columns: 72px minmax(0, 1fr) 78px;
  }
  .result-meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .meta-cell:nth-child(5) {
    grid-column: 1 / -1;
  }
  .meta-cell {
    border-bottom: 1px solid #e1e7f0;
  }
  .nav {
    gap: 12px;
    font-size: 14px;
  }
}
@media (max-width: 720px) {
  .shell {
    width: min(100% - 24px, 1184px);
  }
  .topbar {
    height: auto;
    padding: 14px 0;
  }
  .topbar-inner,
  .nav,
  .footer {
    flex-wrap: wrap;
  }
  .topbar-inner {
    align-items: flex-start;
    gap: 10px;
  }
  .brand {
    font-size: 24px;
  }
  .nav {
    width: 100%;
    gap: 10px;
    font-size: 13px;
  }
  .lang button {
    min-width: 48px;
    padding: 8px 10px;
  }
  .github {
    gap: 4px;
  }
  .hero {
    padding-top: 36px;
  }
  .hero h1 {
    max-width: 330px;
    margin-inline: auto;
    font-size: clamp(30px, 9vw, 38px);
    letter-spacing: -.05em;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }
  .panel {
    padding: 16px;
    min-width: 0;
  }
  .result-card,
  .code-box,
  .input-wrap,
  .input-wrap input {
    min-width: 0;
  }
  .result-main {
    grid-template-columns: 1fr;
    gap: 12px;
    text-align: center;
  }
  .result-shield,
  .timer {
    justify-self: center;
    margin-left: 0;
  }
  .token {
    font-size: clamp(42px, 13vw, 52px);
    letter-spacing: .09em;
  }
  .meta-cell {
    min-width: 0;
    padding: 9px 10px;
    overflow-wrap: anywhere;
  }
}
`;

const CLIENT_JS = `
const maxSecretLength = 256;
const sampleSecret = "FXPYSQPDSJ5U64X363J3SZXUAPWV5UZY";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const hashName = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };
let cachedSecret = "";
let cachedAlgorithm = "";
let cachedKey = null;
const els = {
  secret: document.querySelector("#secret"),
  otpauth: document.querySelector("#otpauth"),
  digits: document.querySelector("#digits"),
  period: document.querySelector("#period"),
  algorithm: document.querySelector("#algorithm"),
  token: document.querySelector("#token"),
  timer: document.querySelector("#timer"),
  timerCircle: document.querySelector("#timerCircle"),
  next: document.querySelector("#next"),
  issuer: document.querySelector("#issuer"),
  account: document.querySelector("#account"),
  metaAlgorithm: document.querySelector("#metaAlgorithm"),
  metaDigits: document.querySelector("#metaDigits"),
  metaPeriod: document.querySelector("#metaPeriod"),
  endpoint: document.querySelector("#endpoint"),
  jsonToken: document.querySelector("#jsonToken"),
  error: document.querySelector("#error"),
  generate: document.querySelector("#generate"),
  copySecret: document.querySelector("#copySecret"),
  copyOtpauth: document.querySelector("#copyOtpauth"),
  copyOtp: document.querySelector("#copyOtp"),
  copyEndpoint: document.querySelector("#copyEndpoint"),
  copyJson: document.querySelector("#copyJson")
};

function normalizeBase32(input) {
  let secret = String(input || "").trim();
  if (secret.includes("%")) {
    try {
      secret = decodeURIComponent(secret);
    } catch {
      throw new Error("Secret URL 编码无效");
    }
  }
  secret = secret.replace(/[\\s-]/g, "").replace(/=+$/g, "").toUpperCase();
  if (!secret) throw new Error("请输入 Secret");
  if (secret.length > maxSecretLength) throw new Error("Secret 过长");
  if (!/^[A-Z2-7]+$/.test(secret)) throw new Error("Secret 只能包含 Base32 字符 A-Z 和 2-7");
  return secret;
}

function applyOtpAuth() {
  const value = els.otpauth.value.trim();
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "otpauth:") return;
    const secret = url.searchParams.get("secret");
    if (secret) els.secret.value = secret;
    const issuer = url.searchParams.get("issuer");
    if (issuer) els.issuer.textContent = issuer;
    const label = decodeURIComponent(url.pathname.replace(/^\\//, ""));
    if (label) els.account.textContent = label.includes(":") ? label.split(":").pop() : label;
  } catch {
    els.error.textContent = "otpauth:// 链接格式无效";
  }
}

function base32ToBytes(input) {
  const secret = normalizeBase32(input);
  let buffer = 0;
  let bitsLeft = 0;
  const out = [];
  for (const char of secret) {
    const value = alphabet.indexOf(char);
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
  let value = BigInt(counter);
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = Number(value & 255n);
    value >>= 8n;
  }
  return bytes;
}

async function cryptoKeyFor(secret, algorithm) {
  if (cachedKey && cachedSecret === secret && cachedAlgorithm === algorithm) {
    return cachedKey;
  }
  cachedSecret = secret;
  cachedAlgorithm = algorithm;
  cachedKey = await crypto.subtle.importKey(
    "raw",
    base32ToBytes(secret),
    { name: "HMAC", hash: { name: hashName[algorithm] } },
    false,
    ["sign"]
  );
  return cachedKey;
}

async function hotp(secret, counter, digits, algorithm) {
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await cryptoKeyFor(secret, algorithm), counterToBytes(counter)));
  const offset = signature[signature.length - 1] & 15;
  const binary =
    ((signature[offset] & 127) * 2 ** 24) +
    ((signature[offset + 1] & 255) << 16) +
    ((signature[offset + 2] & 255) << 8) +
    (signature[offset + 3] & 255);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

function groupedToken(token) {
  return token.length === 6 ? token.slice(0, 3) + " " + token.slice(3) : token.slice(0, 4) + " " + token.slice(4);
}

function setIdle(message = "新代码将在 -- 秒后生成") {
  els.token.textContent = "--- ---";
  els.timer.textContent = "--";
  els.timerCircle.style.setProperty("--progress", "0%");
  els.timerCircle.setAttribute("aria-valuenow", "0");
  els.next.innerHTML = message;
  els.copyOtp.disabled = true;
  els.jsonToken.textContent = "------";
}

async function tick() {
  try {
    els.error.textContent = "";
    applyOtpAuth();
    if (!els.secret.value.trim()) {
      setIdle();
      return;
    }

    const period = Number(els.period.value || 30);
    const digits = Number(els.digits.value || 6);
    const algorithm = els.algorithm.value;
    const secret = normalizeBase32(els.secret.value);
    if (!Number.isInteger(period) || period < 5 || period > 300) {
      throw new Error("Period 必须是 5 到 300 秒");
    }

    const now = Math.floor(Date.now() / 1000);
    const counter = Math.floor(now / period);
    const remaining = period - (now % period);
    const progress = Math.round((remaining / period) * 100);
    const token = await hotp(secret, BigInt(counter), digits, algorithm);
    els.token.textContent = groupedToken(token);
    els.timer.textContent = String(remaining);
    els.timerCircle.style.setProperty("--progress", progress + "%");
    els.timerCircle.setAttribute("aria-valuenow", String(progress));
    els.next.innerHTML = '新代码将在 <b>' + remaining + '</b> 秒后生成';
    els.copyOtp.disabled = false;
    els.endpoint.value = "/tok/" + secret;
    els.jsonToken.textContent = token;
    els.metaAlgorithm.textContent = algorithm;
    els.metaDigits.textContent = String(digits);
    els.metaPeriod.textContent = period + "秒";
  } catch (error) {
    setIdle("新代码将在 -- 秒后生成");
    els.error.textContent = error.message || String(error);
  }
}

function loadFragment() {
  const match = location.hash.match(/^#\\/tok\\/([^?]+)/);
  if (!match) return;
  try {
    els.secret.value = decodeURIComponent(match[1]);
    history.replaceState(null, "", location.pathname + location.search);
  } catch {
    els.error.textContent = "URL fragment 中的 Secret 编码无效";
  }
}

async function copyValue(value, label) {
  try {
    await navigator.clipboard.writeText(value);
    els.error.textContent = label + "已复制";
  } catch {
    els.error.textContent = "复制失败，请手动选择内容";
  }
}

for (const el of [els.secret, els.otpauth, els.digits, els.period, els.algorithm]) {
  el.addEventListener("input", tick);
}

els.generate.addEventListener("click", tick);
els.copySecret.addEventListener("click", () => copyValue(els.secret.value, "密钥"));
els.copyOtpauth.addEventListener("click", () => copyValue(els.otpauth.value, "otpauth:// 链接"));
els.copyEndpoint.addEventListener("click", () => copyValue(els.endpoint.value, "接口地址"));
els.copyJson.addEventListener("click", () => copyValue('{ "token": "' + els.jsonToken.textContent + '" }', "JSON"));
els.copyOtp.addEventListener("click", () => {
  const value = (els.token.textContent || "").replace(/\\s/g, "");
  if (/^\\d{6,8}$/.test(value)) copyValue(value, "验证码");
});

loadFragment();
if (!els.secret.value) els.secret.value = sampleSecret;
tick();
setInterval(tick, 1000);
`;

function homeHtml(scriptNonce: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>2FA Worker - 生成 TOTP 验证码</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="page">
  <header class="topbar">
    <div class="shell topbar-inner">
      <div class="brand"><span class="shield-logo">▣</span><span><strong>2FA</strong> Worker</span></div>
      <nav class="nav" aria-label="主导航">
        <a href="#api">API 文档</a>
        <a href="#guide">使用指南</a>
        <a href="#security">安全性</a>
        <span class="lang" aria-label="语言"><button class="active" type="button">中文</button><button type="button">EN</button></span>
        <a class="github" href="${GITHUB_REPOSITORY_URL}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
      </nav>
    </div>
  </header>

  <main class="shell">
    <section class="hero">
      <div class="hero-art left" aria-hidden="true">
        <span class="dots"></span><span class="cloud c1"></span><span class="cloud c2"></span><span class="cloud c3"></span><span class="hero-shield">⌾</span>
      </div>
      <div class="hero-art right" aria-hidden="true">
        <span class="globe"></span><span class="orange-cloud"></span>
      </div>
      <h1>即时生成 TOTP 验证码</h1>
      <p>根据 TOTP 密钥计算 6 位 2FA 验证码。<br>通过快速 JSON API 进行自动化与集成。</p>
    </section>

    <section class="main-grid">
      <section class="panel">
        <div class="panel-title"><span class="blue-icon">▣</span>生成 TOTP 验证码</div>
        <div class="field">
          <label for="secret">TOTP 密钥 <span class="help">?</span></label>
          <div class="input-wrap"><input id="secret" autocomplete="off" spellcheck="false" value="FXPYSQPDSJ5U64X363J3SZXUAPWV5UZY"><button id="copySecret" class="icon-button" type="button" aria-label="复制密钥">▢</button></div>
        </div>
        <div class="field">
          <label for="otpauth">otpauth:// 链接（可选）<span class="help">?</span></label>
          <div class="input-wrap"><input id="otpauth" autocomplete="off" spellcheck="false" placeholder="otpauth://totp/Example:user@example.com?secret=FXPYSQ..."><button id="copyOtpauth" class="icon-button" type="button" aria-label="复制链接">▢</button></div>
        </div>
        <input id="digits" type="hidden" value="6">
        <input id="period" type="hidden" value="30">
        <input id="algorithm" type="hidden" value="SHA1">
        <button id="generate" class="primary" type="button">↯ 生成验证码</button>
        <div class="result-card">
          <div class="result-main">
            <span class="result-shield">✓</span>
            <div id="token" class="token" aria-live="polite">--- ---</div>
            <div id="timerCircle" class="timer" role="progressbar" aria-label="验证码剩余时间" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="timer-inner"><div><span><b id="timer" class="timer-value">--</b>秒</span><span>剩余</span></div></div></div>
          </div>
          <div class="result-meta">
            <div class="meta-cell"><strong>颁发者示例</strong><span id="issuer">issuer@example.com</span></div>
            <div class="meta-cell"><strong>账户示例</strong><span id="account">user@example.com</span></div>
            <div class="meta-cell"><strong>算法</strong><span id="metaAlgorithm">SHA1</span></div>
            <div class="meta-cell"><strong>位数</strong><span id="metaDigits">6</span></div>
            <div class="meta-cell"><strong>周期</strong><span id="metaPeriod">30秒</span></div>
          </div>
          <div id="next" class="next">新代码将在 <b>--</b> 秒后生成</div>
        </div>
        <p id="error" class="error" aria-live="polite"></p>
        <button id="copyOtp" type="button" hidden disabled>复制验证码</button>
      </section>

      <section id="api" class="panel">
        <div class="panel-title"><span class="blue-icon">&lt;/&gt;</span>JSON API</div>
        <p class="api-desc">以编程方式获取当前 TOTP 验证码。</p>
        <div class="field">
          <label for="endpoint">接口地址</label>
          <div class="input-wrap"><input id="endpoint" readonly value="/tok/FXPYSQPDSJ5U64X363J3SZXUAPWV5UZY"><button id="copyEndpoint" class="icon-button" type="button" aria-label="复制接口">▢</button></div>
        </div>
        <div class="field">
          <label>返回结果（application/json）</label>
          <div class="code-box">
            <button id="copyJson" class="icon-button" type="button" aria-label="复制 JSON">▢</button>
            <div class="code-line"><span>1</span><span>{</span></div>
            <div class="code-line"><span>2</span><span>&nbsp;&nbsp;"token": "<span id="jsonToken" class="green">------</span>"</span></div>
            <div class="code-line"><span>3</span><span>}</span></div>
          </div>
        </div>
        <div class="api-note-box"><span class="blue-icon">ⓘ</span><span>此接口返回 JSON 格式结果，便于与脚本和服务集成。</span></div>
      </section>
    </section>

    <section class="feature-grid" id="guide">
      <div class="feature"><span class="feature-icon">ϟ</span><div><h3>即时 TOTP 验证码</h3><p>生成有效的 6 位数字验证码，实时倒计时确保使用时效性。</p></div></div>
      <div class="feature"><span class="feature-icon">{ }</span><div><h3>JSON API</h3><p>简单、快速、轻量的 API 设计，适合自动化和集成。</p></div></div>
      <div class="feature orange"><span class="feature-icon">☁</span><div><h3>运行在 Cloudflare Workers</h3><p>全球边缘性能，构建速度快，可靠性高。</p></div></div>
      <div class="feature"><span class="feature-icon">●</span><div><h3>无需数据库</h3><p>无状态设计，无需存储、无设置、无需维护。</p></div></div>
    </section>

    <section id="security" class="warning">
      <span class="warning-mark">△</span>
      <div><strong>仅用于测试和自动化用途</strong><span>请勿公开泄露生产环境的密钥。您需对密钥的安全性负责。</span></div>
    </section>

    <footer class="footer">
      <div>© 2025 2FA Worker　·　基于 <a href="https://developers.cloudflare.com/workers/" rel="noreferrer">Cloudflare Workers</a> 构建　·　Web Crypto</div>
      <div class="footer-links"><a href="#api">API 文档</a><a href="#guide">使用指南</a><a href="#security">安全性</a><a href="${GITHUB_REPOSITORY_URL}" target="_blank" rel="noopener noreferrer">GitHub ↗</a></div>
    </footer>
  </main>
</div>
<script nonce="${scriptNonce}">${CLIENT_JS}</script>
</body>
</html>`;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw new HttpError(400, "content-length must be a non-negative number");
    }
    if (contentLength > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "request body is too large");
    }
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "content-type must be application/json");
  }

  const bodyBytes = await request.arrayBuffer();
  if (bodyBytes.byteLength > MAX_JSON_BODY_BYTES) {
    throw new HttpError(413, "request body is too large");
  }
  if (bodyBytes.byteLength === 0) {
    throw new HttpError(400, "request body must be valid JSON");
  }

  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    throw new HttpError(400, "request body must be valid JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "request body must be a JSON object");
  }
  return data as Record<string, unknown>;
}

function allowedMethods(pathname: string): string[] | null {
  if (pathname === "/" || pathname === "/robots.txt" || pathname === "/healthz") return ["GET", "OPTIONS"];
  if (pathname.startsWith("/tok/")) return ["GET", "OPTIONS"];
  if (pathname === "/api/totp") return ["GET", "POST", "OPTIONS"];
  return null;
}

function methodNotAllowed(methods: string[]): Response {
  const headers = securityHeaders("application/json; charset=utf-8", "no-store, max-age=0");
  headers.set("Allow", methods.join(", "));
  return new Response(JSON.stringify({ error: "method not allowed" }), {
    status: 405,
    headers,
  });
}

function optionsResponse(methods: string[]): Response {
  return new Response(null, {
    status: 204,
    headers: new Headers({
      ...COMMON_HEADERS,
      "Cache-Control": "no-store, max-age=0",
      Allow: methods.join(", "),
    }),
  });
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const methods = allowedMethods(url.pathname);

  if (request.method === "OPTIONS") {
    return methods ? optionsResponse(methods) : jsonResponse({ error: "not found" }, 404);
  }

  if (methods && !methods.includes(request.method)) {
    return methodNotAllowed(methods);
  }

  if (url.pathname === "/" && request.method === "GET") {
    const scriptNonce = nonce();
    return htmlResponse(homeHtml(scriptNonce), scriptNonce);
  }

  if (url.pathname === "/robots.txt" && request.method === "GET") {
    return textResponse("User-agent: *\nDisallow: /\n");
  }

  if (url.pathname === "/healthz" && request.method === "GET") {
    return jsonResponse({ ok: true });
  }

  if (url.pathname.startsWith("/tok/") && request.method === "GET") {
    const secret = url.pathname.slice("/tok/".length);
    const result = await generateTotp(secret, parseOptionsFromSearchParams(url.searchParams));
    return jsonResponse({ token: result.token });
  }

  if (url.pathname === "/api/totp" && request.method === "GET") {
    const secret = url.searchParams.get("secret");
    if (!secret) throw new HttpError(400, "secret query parameter is required");
    const result = await generateTotp(secret, parseOptionsFromSearchParams(url.searchParams));
    return jsonResponse(result);
  }

  if (url.pathname === "/api/totp" && request.method === "POST") {
    const data = await readJsonBody(request);
    const secret = data.secret;
    if (typeof secret !== "string") throw new HttpError(400, "secret is required");
    const result = await generateTotp(secret, parseOptionsFromObject(data));
    return jsonResponse(result);
  }

  return jsonResponse({ error: "not found" }, 404);
}

export { base32ToBytes, generateTotp, hotp, normalizeBase32 };

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handleRequest(request);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse({ error: error.message }, error.status);
      }

      // Do not include raw error details in the response. They may contain implementation data.
      return jsonResponse({ error: "internal server error" }, 500);
    }
  },
};
