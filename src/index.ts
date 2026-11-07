/**
 * Cloudflare Worker TOTP generator: HTTP routing and response layer.
 *
 * Intended use:
 * - Serve a local-browser TOTP UI at GET /
 * - Provide a 2fa.live-like compatibility endpoint at GET /tok/:base32Secret
 * - Provide safer API variants at /api/totp, preferably POST instead of putting secrets in URLs.
 *
 * Security rule: never log request URLs, request bodies, or decoded secrets.
 */

import { generateTotp, normalizeBase32, base32ToBytes, hotp, TotpError, type RawTotpOptions, type ByteArray } from "./totp-core";
import { ASSET_ROUTES } from "./assets";
import { homeHtml, type Lang } from "./page";

const MAX_JSON_BODY_BYTES = 2048;
const RATE_LIMIT_PERIOD_SECONDS = 10;

// Env comes from worker-configuration.d.ts (`npm run cf-typegen`). Bindings are
// treated as optional because tests and plain local runs pass none.
type WorkerEnv = Partial<Env>;

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const COMMON_HEADERS: Record<string, string> = {
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), usb=(), payment=(), clipboard-write=(self)",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function securityHeaders(contentType: string, cacheControl: string): Headers {
  const headers = new Headers(COMMON_HEADERS);
  headers.set("Cache-Control", cacheControl);
  headers.set("Content-Type", contentType);
  if (cacheControl.includes("no-store")) {
    headers.set("Pragma", "no-cache");
  }
  // Defense in depth for responses rendered as documents; the HTML page
  // replaces this with its hash-based policy.
  headers.set("Content-Security-Policy", "default-src 'none'");
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

type HtmlDocument = { body: string; csp: string; etag: string };

// Static, secret-free page bytes: safe to memoize per isolate. The resolved
// value (not a Promise) is cached so no request awaits another request's work.
const homeDocuments: Partial<Record<Lang, HtmlDocument>> = {};

/**
 * Mirrors the page's own rule for navigator.language: Chinese when the most
 * preferred language is Chinese, English for any other language, and the
 * historical Chinese default when the header is absent.
 */
function preferredLang(request: Request): Lang {
  let best: Lang = "zh";
  let bestQ = 0;
  for (const part of (request.headers.get("accept-language") ?? "").split(",")) {
    const [range = "", ...params] = part.trim().toLowerCase().split(";");
    if (!range || range === "*") continue;
    const qParam = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    if (!(q > bestQ)) continue;
    best = range.startsWith("zh") ? "zh" : "en";
    bestQ = q;
  }
  return best;
}

async function sha256Base64(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest));
}

async function inlineHashes(html: string, tag: "script" | "style"): Promise<string> {
  const blocks = [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))];
  const hashes = await Promise.all(blocks.map(async ([, content = ""]) => `'sha256-${await sha256Base64(content)}'`));
  return hashes.join(" ");
}

async function getHomeDocument(lang: Lang): Promise<HtmlDocument> {
  const cached = homeDocuments[lang];
  if (cached) return cached;
  const body = homeHtml(lang);
  const csp = [
    "default-src 'none'",
    `script-src ${await inlineHashes(body, "script")}`,
    `style-src ${await inlineHashes(body, "style")}`,
    "img-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  const etag = `"${(await sha256Base64(`${csp}\n${body}`)).slice(0, 27)}"`;
  const page = { body, csp, etag };
  homeDocuments[lang] = page;
  return page;
}

// Cloudflare weakens strong ETags (W/"…") when it compresses a response, so
// the comparison ignores the weak prefix.
function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((tag) => {
    const value = tag.trim();
    return value === "*" || value.replace(/^W\//, "") === etag;
  });
}

async function htmlResponse(request: Request): Promise<Response> {
  const lang = preferredLang(request);
  const page = await getHomeDocument(lang);
  const headers = securityHeaders("text/html; charset=utf-8", "no-cache");
  headers.set("Content-Security-Policy", page.csp);
  headers.set("ETag", page.etag);
  headers.set("Content-Language", lang === "en" ? "en" : "zh-CN");
  headers.set("Vary", "Accept-Language");
  if (etagMatches(request.headers.get("if-none-match"), page.etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(page.body, { headers });
}

function dataUriToBytes(dataUri: string): ByteArray {
  const marker = "base64,";
  const markerIndex = dataUri.indexOf(marker);
  if (markerIndex < 0) throw new Error("invalid image data URI");

  const binary = atob(dataUri.slice(markerIndex + marker.length));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Decoded once at module load: favicons are static and secret-free, so unlike
// the per-request HMAC keys they are safe to keep in isolate memory.
const ASSET_BYTES: Record<string, ByteArray> = Object.fromEntries(
  Object.entries(ASSET_ROUTES).map(([pathname, dataUri]) => [pathname, dataUriToBytes(dataUri)]),
);

function pngResponse(bytes: ByteArray): Response {
  // Not immutable: the favicon URLs are unversioned, so a changed icon must
  // still be picked up once max-age expires.
  return new Response(bytes, {
    headers: securityHeaders("image/png", "public, max-age=86400"),
  });
}

function isJsonMediaType(contentType: string): boolean {
  const [essence = ""] = contentType.split(";", 1);
  return essence.trim().toLowerCase() === "application/json";
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
  if (!isJsonMediaType(contentType)) {
    throw new HttpError(415, "content-type must be application/json");
  }

  // Stream with a running total so chunked bodies cannot bypass the size
  // limit by omitting content-length.
  const body = request.body;
  if (!body) {
    throw new HttpError(400, "request body must be valid JSON");
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "request body is too large");
    }
    chunks.push(value);
  }
  if (total === 0) {
    throw new HttpError(400, "request body must be valid JSON");
  }
  const bodyBytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bodyBytes));
  } catch {
    throw new HttpError(400, "request body must be valid JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "request body must be a JSON object");
  }
  return data as Record<string, unknown>;
}

function rawOptionsFromSearchParams(params: URLSearchParams): RawTotpOptions {
  return {
    period: params.get("period") ?? undefined,
    digits: params.get("digits") ?? undefined,
    algorithm: params.get("algorithm") ?? undefined,
    t0: params.get("t0") ?? undefined,
    time: params.get("time") ?? undefined,
    timestampMs: params.get("timestampMs") ?? undefined,
  };
}

function isTokenEndpoint(pathname: string): boolean {
  return pathname === "/api/totp" || pathname.startsWith("/tok/");
}

/** First four hextets of an IPv6 address, or null if it is not one. */
function ipv6Prefix64(ip: string): string | null {
  let address = ip.toLowerCase();
  const v4Tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4Tail) {
    const [a = 0, b = 0, c = 0, d = 0] = v4Tail.slice(1).map(Number);
    address = `${address.slice(0, v4Tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail] : head;
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(":");
}

/**
 * IPv4 clients are keyed per address; IPv6 clients per /64, because SLAAC
 * privacy addresses let one host rotate freely inside its /64.
 */
export function rateLimitKey(request: Request): string {
  const ip = request.headers.get("cf-connecting-ipv6") ?? request.headers.get("cf-connecting-ip");
  if (!ip) return "ip:unknown";
  if (!ip.includes(":")) return `ip4:${ip}`;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return `ip4:${mapped[1]}`;
  const prefix = ipv6Prefix64(ip);
  return prefix ? `ip6:${prefix}::/64` : `ip:${ip}`;
}

/**
 * Best-effort per-IP rate limiting for the token endpoints. Fails open: a
 * missing binding (local dev, tests) or a limiter error never blocks traffic.
 */
async function isRateLimited(request: Request, env: WorkerEnv | undefined): Promise<boolean> {
  const limiter = env?.TOTP_RATE_LIMITER;
  if (!limiter) return false;
  const key = rateLimitKey(request);
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch {
    return false;
  }
}

function rateLimitedResponse(): Response {
  const headers = securityHeaders("application/json; charset=utf-8", "no-store, max-age=0");
  headers.set("Retry-After", String(RATE_LIMIT_PERIOD_SECONDS));
  return new Response(JSON.stringify({ error: "rate limit exceeded, retry later" }), {
    status: 429,
    headers,
  });
}

function allowedMethods(pathname: string): string[] | null {
  if (pathname === "/" || pathname === "/robots.txt" || pathname === "/healthz" || pathname in ASSET_ROUTES) {
    return ["GET", "HEAD", "OPTIONS"];
  }
  if (pathname.startsWith("/tok/")) return ["GET", "HEAD", "OPTIONS"];
  if (pathname === "/api/totp") return ["GET", "HEAD", "POST", "OPTIONS"];
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
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      Allow: methods.join(", "),
    }),
  });
}

function decodeTokPathSecret(pathname: string): string {
  try {
    return decodeURIComponent(pathname.slice("/tok/".length));
  } catch {
    throw new HttpError(400, "secret contains invalid percent-encoding");
  }
}

async function handleRequest(request: Request, env: WorkerEnv | undefined): Promise<Response> {
  const url = new URL(request.url);
  const methods = allowedMethods(url.pathname);
  // HEAD reuses the GET handlers; the body is stripped in fetch().
  const method = request.method === "HEAD" ? "GET" : request.method;

  if (method === "OPTIONS") {
    return methods ? optionsResponse(methods) : jsonResponse({ error: "not found" }, 404);
  }

  if (methods && !methods.includes(request.method)) {
    return methodNotAllowed(methods);
  }

  if (isTokenEndpoint(url.pathname) && (await isRateLimited(request, env))) {
    return rateLimitedResponse();
  }

  if (url.pathname === "/" && method === "GET") {
    return htmlResponse(request);
  }

  const assetBytes = ASSET_BYTES[url.pathname];
  if (assetBytes && method === "GET") {
    return pngResponse(assetBytes);
  }

  if (url.pathname === "/robots.txt" && method === "GET") {
    return textResponse("User-agent: *\nDisallow: /\n");
  }

  if (url.pathname === "/healthz" && method === "GET") {
    // Millisecond server time for the page's clock-skew check: local workerd
    // sends no Date header, and Date only has whole-second precision.
    return jsonResponse({ ok: true, now: Date.now() });
  }

  if (url.pathname.startsWith("/tok/") && method === "GET") {
    const secret = decodeTokPathSecret(url.pathname);
    const result = await generateTotp(secret, rawOptionsFromSearchParams(url.searchParams));
    return jsonResponse({ token: result.token });
  }

  if (url.pathname === "/api/totp" && method === "GET") {
    const secret = url.searchParams.get("secret");
    if (!secret) throw new HttpError(400, "secret query parameter is required");
    const result = await generateTotp(secret, rawOptionsFromSearchParams(url.searchParams));
    return jsonResponse(result);
  }

  if (url.pathname === "/api/totp" && method === "POST") {
    const data = await readJsonBody(request);
    const secret = data["secret"];
    if (typeof secret !== "string") throw new HttpError(400, "secret is required");
    const result = await generateTotp(secret, data as RawTotpOptions);
    return jsonResponse(result);
  }

  return jsonResponse({ error: "not found" }, 404);
}

export { base32ToBytes, generateTotp, hotp, normalizeBase32 };

export default {
  async fetch(request: Request, env?: WorkerEnv): Promise<Response> {
    let response: Response;
    try {
      response = await handleRequest(request, env);
    } catch (error) {
      if (error instanceof TotpError) {
        // Field validation (including an over-long secret) is a client error
        // about a parameter, not about payload size: 413 stays reserved for
        // bodies over MAX_JSON_BODY_BYTES.
        response = jsonResponse({ error: error.message }, 400);
      } else if (error instanceof HttpError) {
        response = jsonResponse({ error: error.message }, error.status);
        if (error.status === 415) response.headers.set("Accept", "application/json");
      } else {
        // Do not include raw error details in the response. They may contain implementation data.
        response = jsonResponse({ error: "internal server error" }, 500);
      }
    }

    if (request.method === "HEAD") {
      return new Response(null, { status: response.status, headers: response.headers });
    }
    return response;
  },
};
