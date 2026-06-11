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
import { homeHtml } from "./page";

const MAX_JSON_BODY_BYTES = 2048;
const RATE_LIMIT_PERIOD_SECONDS = 10;

/** Shape of the Workers Rate Limiting binding (wrangler.jsonc "ratelimits"). */
type RateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

type Env = {
  TOTP_RATE_LIMITER?: RateLimiter;
};

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

function securityHeaders(contentType: string, cacheControl: string, nonce?: string): Headers {
  const headers = new Headers(COMMON_HEADERS);
  headers.set("Cache-Control", cacheControl);
  headers.set("Content-Type", contentType);
  if (cacheControl.includes("no-store")) {
    headers.set("Pragma", "no-cache");
  }
  if (contentType.startsWith("text/html")) {
    const scriptPolicy = nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'";
    const stylePolicy = nonce ? `style-src 'self' 'nonce-${nonce}'` : "style-src 'self' 'unsafe-inline'";
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        scriptPolicy,
        stylePolicy,
        "img-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join("; "),
    );
  } else {
    // Defense in depth for non-HTML responses rendered as documents.
    headers.set("Content-Security-Policy", "default-src 'none'");
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
    headers: securityHeaders("text/html; charset=utf-8", "no-store, max-age=0", nonce),
  });
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
  return new Response(bytes, {
    headers: securityHeaders("image/png", "public, max-age=86400, immutable"),
  });
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
    data = JSON.parse(new TextDecoder().decode(bodyBytes));
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

/**
 * Best-effort per-IP rate limiting for the token endpoints. Fails open: a
 * missing binding (local dev, tests) or a limiter error never blocks traffic.
 */
async function isRateLimited(request: Request, env: Env | undefined): Promise<boolean> {
  const limiter = env?.TOTP_RATE_LIMITER;
  if (!limiter) return false;
  const key = request.headers.get("cf-connecting-ip") ?? "unknown";
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
      Allow: methods.join(", "),
    }),
  });
}

async function handleRequest(request: Request, env: Env | undefined): Promise<Response> {
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
    const scriptNonce = nonce();
    return htmlResponse(homeHtml(scriptNonce), scriptNonce);
  }

  if (url.pathname in ASSET_BYTES && method === "GET") {
    return pngResponse(ASSET_BYTES[url.pathname]);
  }

  if (url.pathname === "/robots.txt" && method === "GET") {
    return textResponse("User-agent: *\nDisallow: /\n");
  }

  if (url.pathname === "/healthz" && method === "GET") {
    return jsonResponse({ ok: true });
  }

  if (url.pathname.startsWith("/tok/") && method === "GET") {
    const secret = url.pathname.slice("/tok/".length);
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
    const secret = data.secret;
    if (typeof secret !== "string") throw new HttpError(400, "secret is required");
    const result = await generateTotp(secret, data as RawTotpOptions);
    return jsonResponse(result);
  }

  return jsonResponse({ error: "not found" }, 404);
}

export { base32ToBytes, generateTotp, hotp, normalizeBase32 };

export default {
  async fetch(request: Request, env?: Env): Promise<Response> {
    let response: Response;
    try {
      response = await handleRequest(request, env);
    } catch (error) {
      if (error instanceof TotpError) {
        response = jsonResponse({ error: error.message }, error.kind === "too_long" ? 413 : 400);
      } else if (error instanceof HttpError) {
        response = jsonResponse({ error: error.message }, error.status);
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
