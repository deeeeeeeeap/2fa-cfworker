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
const CLOUDFLARE_MARK = "data:image/png;base64,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";

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
.shield-logo {
  position: relative;
  width: 46px;
  height: 54px;
  flex: 0 0 auto;
  background: linear-gradient(180deg, #2f86ff, #1268ee);
  box-shadow: 0 12px 24px rgba(18, 109, 237, .22);
  clip-path: polygon(50% 0, 88% 15%, 88% 56%, 50% 100%, 12% 56%, 12% 15%);
}
.shield-logo::before {
  content: "";
  position: absolute;
  left: 14px;
  top: 19px;
  width: 18px;
  height: 18px;
  border: 3px solid #fff;
  border-radius: 3px;
  box-sizing: border-box;
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
.hero-art.right {
  right: 32px;
  top: 72px;
  width: 180px;
  height: 130px;
}
.cf-logo {
  position: absolute;
  right: 0;
  bottom: 4px;
  width: 154px;
  height: auto;
}
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
  right: 7px;
  top: 5px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #52617a;
  cursor: pointer;
  transition: background .16s ease, color .16s ease, transform .16s ease;
}
.icon-button:hover,
.icon-button:focus-visible {
  background: rgba(18, 104, 238, .09);
  color: #1268ee;
  outline: none;
}
.icon-button:active {
  transform: translateY(1px);
}
.icon-button::before,
.icon-button::after {
  content: "";
  position: absolute;
  box-sizing: border-box;
  border: 1.7px solid currentColor;
  border-radius: 4px;
}
.icon-button::before {
  left: 9px;
  top: 6px;
  width: 12px;
  height: 14px;
  background: #fff;
}
.icon-button::after {
  left: 6px;
  top: 9px;
  width: 12px;
  height: 14px;
  background: transparent;
}
.code-box .icon-button::before {
  background: #101826;
}
.icon-button.copied {
  color: #0f7a46;
}
.icon-button.copied::before {
  left: 8px;
  top: 8px;
  width: 13px;
  height: 8px;
  border-top: 0;
  border-right: 0;
  border-radius: 0;
  background: transparent;
  transform: rotate(-45deg);
}
.icon-button.copied::after {
  display: none;
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
  grid-template-columns: minmax(0, 1fr) 96px;
  align-items: center;
  gap: 10px;
  padding: 14px 18px 14px 28px;
}
.token {
  width: 100%;
  border: 0;
  border-radius: 14px;
  padding: 9px 10px;
  appearance: none;
  background: transparent;
  text-align: center;
  color: #1f6fe8;
  font-size: clamp(42px, 4.8vw, 64px);
  line-height: 1;
  font-weight: 900;
  letter-spacing: .12em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: pointer;
  transition: background .16s ease, color .16s ease, box-shadow .16s ease;
}
.token:hover,
.token:focus-visible {
  background: rgba(18, 104, 238, .07);
  box-shadow: inset 0 0 0 1px rgba(18, 104, 238, .12);
  outline: none;
}
.token[data-copyable="false"] {
  cursor: default;
}
.token[data-copyable="false"]:hover {
  background: transparent;
  box-shadow: none;
}
.token.copied {
  color: #0f61d9;
  background: rgba(18, 104, 238, .10);
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
  border-top: 1px solid #d9e3f1;
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
.feature-icon img {
  width: 34px;
  max-width: 100%;
  height: auto;
  display: block;
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
    grid-template-columns: minmax(0, 1fr) 78px;
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
  .timer {
    justify-self: center;
  }
  .token {
    font-size: clamp(42px, 13vw, 52px);
    letter-spacing: .09em;
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
  endpoint: document.querySelector("#endpoint"),
  jsonToken: document.querySelector("#jsonToken"),
  error: document.querySelector("#error"),
  generate: document.querySelector("#generate"),
  copySecret: document.querySelector("#copySecret"),
  copyOtpauth: document.querySelector("#copyOtpauth"),
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
  els.token.dataset.copyable = "false";
  els.token.setAttribute("aria-disabled", "true");
  els.timer.textContent = "--";
  els.timerCircle.style.setProperty("--progress", "0%");
  els.timerCircle.setAttribute("aria-valuenow", "0");
  els.next.innerHTML = message;
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
    els.token.dataset.copyable = "true";
    els.token.setAttribute("aria-disabled", "false");
    els.timer.textContent = String(remaining);
    els.timerCircle.style.setProperty("--progress", progress + "%");
    els.timerCircle.setAttribute("aria-valuenow", String(progress));
    els.next.innerHTML = '新代码将在 <b>' + remaining + '</b> 秒后生成';
    els.endpoint.value = "/tok/" + secret;
    els.jsonToken.textContent = token;
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

function flashCopied(element) {
  if (!element) return;
  element.classList.add("copied");
  window.setTimeout(() => element.classList.remove("copied"), 850);
}

async function copyValue(value, trigger) {
  try {
    await navigator.clipboard.writeText(value);
    flashCopied(trigger);
    els.error.textContent = "";
  } catch {
    els.error.textContent = "复制失败，请手动选择内容";
  }
}

for (const el of [els.secret, els.otpauth, els.digits, els.period, els.algorithm]) {
  el.addEventListener("input", tick);
}

els.generate.addEventListener("click", tick);
els.copySecret.addEventListener("click", (event) => copyValue(els.secret.value, event.currentTarget));
els.copyOtpauth.addEventListener("click", (event) => copyValue(els.otpauth.value, event.currentTarget));
els.copyEndpoint.addEventListener("click", (event) => copyValue(els.endpoint.value, event.currentTarget));
els.copyJson.addEventListener("click", (event) => copyValue('{ "token": "' + els.jsonToken.textContent + '" }', event.currentTarget));
els.token.addEventListener("click", () => {
  const value = (els.token.textContent || "").replace(/\\s/g, "");
  if (/^\\d{6,8}$/.test(value)) copyValue(value, els.token);
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
      <div class="brand"><span class="shield-logo" aria-hidden="true"></span><span><strong>2FA</strong> Worker</span></div>
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
      <div class="hero-art right" aria-hidden="true">
        <img class="cf-logo" src="${CLOUDFLARE_MARK}" alt="">
      </div>
      <h1>即时生成 TOTP 验证码</h1>
      <p>根据 TOTP 密钥计算 6 位 2FA 验证码。<br>通过快速 JSON API 进行自动化与集成。</p>
    </section>

    <section class="main-grid">
      <section class="panel">
        <div class="panel-title"><span class="blue-icon">▣</span>生成 TOTP 验证码</div>
        <div class="field">
          <label for="secret">TOTP 密钥 <span class="help">?</span></label>
          <div class="input-wrap"><input id="secret" autocomplete="off" spellcheck="false" value="FXPYSQPDSJ5U64X363J3SZXUAPWV5UZY"><button id="copySecret" class="icon-button" type="button" aria-label="复制密钥" title="复制密钥"></button></div>
        </div>
        <div class="field">
          <label for="otpauth">otpauth:// 链接（可选）<span class="help">?</span></label>
          <div class="input-wrap"><input id="otpauth" autocomplete="off" spellcheck="false" placeholder="otpauth://totp/Example:user@example.com?secret=FXPYSQ..."><button id="copyOtpauth" class="icon-button" type="button" aria-label="复制链接" title="复制链接"></button></div>
        </div>
        <input id="digits" type="hidden" value="6">
        <input id="period" type="hidden" value="30">
        <input id="algorithm" type="hidden" value="SHA1">
        <button id="generate" class="primary" type="button">↯ 生成验证码</button>
        <div class="result-card">
          <div class="result-main">
            <button id="token" class="token" type="button" aria-live="polite" aria-label="点击复制验证码" title="点击复制验证码" data-copyable="false" aria-disabled="true">--- ---</button>
            <div id="timerCircle" class="timer" role="progressbar" aria-label="验证码剩余时间" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="timer-inner"><div><span><b id="timer" class="timer-value">--</b>秒</span><span>剩余</span></div></div></div>
          </div>
          <div id="next" class="next">新代码将在 <b>--</b> 秒后生成</div>
        </div>
        <p id="error" class="error" aria-live="polite"></p>
      </section>

      <section id="api" class="panel">
        <div class="panel-title"><span class="blue-icon">&lt;/&gt;</span>JSON API</div>
        <p class="api-desc">以编程方式获取当前 TOTP 验证码。</p>
        <div class="field">
          <label for="endpoint">接口地址</label>
          <div class="input-wrap"><input id="endpoint" readonly value="/tok/FXPYSQPDSJ5U64X363J3SZXUAPWV5UZY"><button id="copyEndpoint" class="icon-button" type="button" aria-label="复制接口" title="复制接口"></button></div>
        </div>
        <div class="field">
          <label>返回结果（application/json）</label>
          <div class="code-box">
            <button id="copyJson" class="icon-button" type="button" aria-label="复制 JSON" title="复制 JSON"></button>
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
      <div class="feature orange"><span class="feature-icon"><img src="${CLOUDFLARE_MARK}" alt=""></span><div><h3>运行在 Cloudflare Workers</h3><p>全球边缘性能，构建速度快，可靠性高。</p></div></div>
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
