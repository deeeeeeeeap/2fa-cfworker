import { describe, expect, it } from "vitest";
import worker from "../src/index";

const RFC_SHA1_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const RFC_SHA256_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
const PNG_MAGIC_BYTES = [137, 80, 78, 71, 13, 10, 26, 10];

type TestEnv = Parameters<typeof worker.fetch>[1];

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://totp.example.test${path}`, init);
}

async function json(path: string, init?: RequestInit, env?: TestEnv): Promise<{ body: any; response: Response }> {
  const response = await worker.fetch(request(path, init), env);
  return { body: await response.json(), response };
}

describe("Worker routes", () => {
  it("serves the local-browser UI with uncached nonce HTML and CSP", async () => {
    const response = await worker.fetch(request("/"));
    const body = await response.text();
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = csp.match(/script-src 'self' 'nonce-([^']+)'/)?.[1];

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self'");
    expect(csp).not.toContain("data:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`style-src 'self' 'nonce-${nonce}'`);
    expect(body).toContain(`<script nonce="${nonce}">`);
    expect(body).toContain(`<style nonce="${nonce}">`);

    expect(body).toContain("即时生成 TOTP 验证码");
    expect(body).toContain("JSON API");
    expect(body).toContain("仅用于测试和自动化用途");
    expect(body).toContain("https://github.com/deeeeeeeeap/2fa-cfworker");
    expect(body).toContain("Generate TOTP codes instantly");
    expect(body).toContain("新代码将在 <b>--</b> 秒后生成");
    expect(body).toContain("粘贴 Base32 TOTP 密钥，或打开 /#/tok/YOUR_SECRET 自动填入");
    expect(body).toContain("/#/tok/YOUR_SECRET");
    expect(body).toContain("loadUrlSecret");
    expect(body).not.toContain("FXPYSQPDSJ5U64X363J3SZXUAPWV5UZY");

    expect(body).toContain("id=\"secret\" autocomplete=\"off\" spellcheck=\"false\" value=\"\" aria-describedby=\"secret-help secret-error\" type=\"password\"");
    expect(body).toContain("id=\"toggleSecret\" class=\"icon-button reveal-toggle\"");
    expect(body).toContain("id=\"driftWarn\" class=\"drift-warn\" role=\"status\" hidden");
    expect(body).toContain(`© ${new Date().getFullYear()} 2FA Worker`);
    expect(body).toContain("id=\"secret-help\" class=\"field-hint\"");
    expect(body).toContain("id=\"secret-error\" class=\"field-error\" role=\"alert\" aria-live=\"assertive\"");
    expect(body).toContain("id=\"endpoint\" readonly value=\"\"");
    expect(body).toContain("<details id=\"advanced\" class=\"advanced\">");
    expect(body).toContain("<select id=\"algorithm\">");
    expect(body).toContain("<option value=\"SHA512\">SHA512</option>");
    expect(body).toContain("<select id=\"digits\">");
    expect(body).toContain("id=\"period\" type=\"number\" inputmode=\"numeric\" min=\"5\" max=\"300\"");
    expect(body).toContain("data-lang=\"zh\"");
    expect(body).toContain("data-lang=\"en\"");
    expect(body).not.toContain("href=\"#api\"");
    expect(body).not.toContain("href=\"#guide\"");
    expect(body).not.toContain("href=\"#security\"");

    expect(body).toContain("rel=\"icon\" type=\"image/png\" sizes=\"192x192\" href=\"/favicon.png\"");
    expect(body).toContain("rel=\"shortcut icon\" type=\"image/png\" href=\"/favicon.ico\"");
    expect(body).toContain("rel=\"apple-touch-icon\" sizes=\"192x192\" href=\"/apple-touch-icon.png\"");

    // All page imagery is inline SVG; only favicons remain as PNG routes.
    expect(body).toContain("class=\"brand-mark\"");
    expect(body).toContain("class=\"hero-orbit\"");
    expect(body).toContain("id=\"handSec\"");
    expect(body).toContain("class=\"hero-badge");
    expect(body).toContain("class=\"feature-icon\"");
    expect(body).toContain("class=\"warning-mark\"");
    expect(body).not.toContain("/assets/");
    expect(body).not.toContain("data:image/");

    // Theme system: resolved theme on <html>, pre-paint script, manual toggle.
    expect(body).toContain("data-theme=\"light\"");
    expect(body).toContain("(prefers-color-scheme: dark)");
    expect(body).toContain("id=\"themeToggle\"");
    expect(body).toContain("[data-theme=\"dark\"]");

    expect(body).toContain("id=\"token\" class=\"token\" type=\"button\"");
    expect(body).toContain("aria-label=\"点击复制验证码\"");
    expect(body).toContain("class=\"digit idle\"");
    expect(body).toContain("id=\"ringFg\" class=\"ring-fg\"");
    expect(body).toContain("role=\"alert\" aria-live=\"assertive\"");
    expect(body).toContain("id=\"status\" class=\"sr-only\" aria-live=\"polite\" aria-atomic=\"true\"");
    expect(body).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("serves favicons as immutable PNG routes", async () => {
    const paths = ["/favicon.ico", "/favicon.png", "/apple-touch-icon.png"];

    for (const path of paths) {
      const response = await worker.fetch(request(path));
      const bytes = new Uint8Array(await response.arrayBuffer());

      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toContain("image/png");
      expect(response.headers.get("cache-control"), path).toContain("public");
      expect(response.headers.get("cache-control"), path).toContain("immutable");
      expect(response.headers.get("strict-transport-security"), path).toBe("max-age=31536000");
      expect(bytes.length, path).toBeGreaterThan(1000);
      expect(Array.from(bytes.slice(0, 8)), path).toEqual(PNG_MAGIC_BYTES);
    }
  });

  it("returns health and robots responses", async () => {
    const health = await json("/healthz");
    expect(health.response.status).toBe(200);
    expect(health.response.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(health.body).toEqual({ ok: true });

    const robots = await worker.fetch(request("/robots.txt"));
    expect(robots.status).toBe(200);
    await expect(robots.text()).resolves.toContain("Disallow: /");
    expect(robots.headers.get("cache-control")).toContain("public");
  });

  it("answers HEAD requests with GET-identical headers and an empty body", async () => {
    const get = await worker.fetch(request("/healthz"));
    const head = await worker.fetch(request("/healthz", { method: "HEAD" }));

    expect(head.status).toBe(200);
    await expect(head.text()).resolves.toBe("");
    for (const name of [
      "content-type",
      "cache-control",
      "pragma",
      "x-robots-tag",
      "strict-transport-security",
      "x-content-type-options",
      "x-frame-options",
      "referrer-policy",
    ]) {
      expect(head.headers.get(name), name).toBe(get.headers.get(name));
    }

    const headHome = await worker.fetch(request("/", { method: "HEAD" }));
    expect(headHome.status).toBe(200);
    expect(headHome.headers.get("content-type")).toContain("text/html");
    await expect(headHome.text()).resolves.toBe("");
  });

  it("returns a 2fa.live-compatible /tok response", async () => {
    const { body, response } = await json(`/tok/${RFC_SHA1_SECRET_BASE32}?time=59&digits=8`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(body).toEqual({ token: "94287082" });
  });

  it("no longer serves bare /SECRET convenience paths", async () => {
    const { body, response } = await json(`/${RFC_SHA1_SECRET_BASE32}`);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(body).toEqual({ error: "not found" });
    expect(JSON.stringify(body)).not.toContain(RFC_SHA1_SECRET_BASE32);
  });

  it("returns metadata for GET and POST /api/totp", async () => {
    const getResult = await json(`/api/totp?secret=${RFC_SHA1_SECRET_BASE32}&time=59&digits=8`);
    expect(getResult.response.headers.get("cache-control")).toContain("no-store");
    expect(getResult.response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(getResult.body).toMatchObject({
      token: "94287082",
      period: 30,
      remaining: 1,
      remainingMs: 1000,
      validUntil: "1970-01-01T00:01:00.000Z",
      digits: 8,
      algorithm: "SHA1",
      counter: "1",
    });

    const timestampMsResult = await json(`/api/totp?secret=${RFC_SHA1_SECRET_BASE32}&timestampMs=59000&digits=8`);
    expect(timestampMsResult.body).toMatchObject({
      token: "94287082",
      remainingMs: 1000,
      validUntil: "1970-01-01T00:01:00.000Z",
    });

    const postResult = await json("/api/totp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: RFC_SHA1_SECRET_BASE32, time: 59, digits: 8 }),
    });
    expect(postResult.response.headers.get("cache-control")).toContain("no-store");
    expect(postResult.response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(postResult.body).toMatchObject({
      token: "94287082",
      counter: "1",
      remainingMs: 1000,
      validUntil: "1970-01-01T00:01:00.000Z",
    });
  });

  it("requires an explicit secret for JSON API requests", async () => {
    const getResult = await json("/api/totp?time=59");
    expect(getResult.response.status).toBe(400);
    expect(getResult.response.headers.get("cache-control")).toContain("no-store");
    expect(getResult.response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(getResult.body).toEqual({ error: "secret query parameter is required" });

    const postResult = await json("/api/totp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ time: 59 }),
    });
    expect(postResult.response.status).toBe(400);
    expect(postResult.response.headers.get("cache-control")).toContain("no-store");
    expect(postResult.response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(postResult.body).toEqual({ error: "secret is required" });
  });

  it("wires period, algorithm, and t0 query parameters through to the TOTP core", async () => {
    // RFC 6238 Appendix B SHA256 vector: T=59 -> 46119246.
    const sha256 = await json(`/api/totp?secret=${RFC_SHA256_SECRET_BASE32}&algorithm=SHA256&time=59&digits=8`);
    expect(sha256.response.status).toBe(200);
    expect(sha256.body).toMatchObject({ token: "46119246", algorithm: "SHA256" });

    // t0=30 shifts the epoch: time=89 lands in the same slot as time=59.
    const shifted = await json(`/api/totp?secret=${RFC_SHA1_SECRET_BASE32}&time=89&t0=30&digits=8`);
    expect(shifted.response.status).toBe(200);
    expect(shifted.body).toMatchObject({ token: "94287082", counter: "1" });

    // period=60 keeps time=59 in counter 0 (RFC 4226 counter-0 vector).
    const longPeriod = await json(`/api/totp?secret=${RFC_SHA1_SECRET_BASE32}&time=59&period=60&digits=8`);
    expect(longPeriod.response.status).toBe(200);
    expect(longPeriod.body).toMatchObject({ token: "84755224", period: 60, counter: "0", remaining: 1 });
  });

  it("rejects POSTs with wrong content-type, empty bodies, and oversize chunked streams", async () => {
    const wrongType = await json("/api/totp", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect(wrongType.response.status).toBe(415);
    expect(wrongType.body.error).toBe("content-type must be application/json");

    const empty = await json("/api/totp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "",
    });
    expect(empty.response.status).toBe(400);
    expect(empty.body.error).toBe("request body must be valid JSON");

    // A chunked stream without content-length must still hit the streaming
    // size limit instead of bypassing the header-based check.
    const chunk = new TextEncoder().encode("x".repeat(1024));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const oversized = await json("/api/totp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(oversized.response.status).toBe(413);
    expect(oversized.body.error).toBe("request body is too large");
  });

  it("handles malformed and oversized JSON as client errors without echoing secrets", async () => {
    const malformed = await json("/api/totp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.response.status).toBe(400);
    expect(malformed.response.headers.get("cache-control")).toContain("no-store");
    expect(malformed.body.error).toBe("request body must be valid JSON");

    const secret = "A".repeat(3000);
    const oversized = await json("/api/totp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    expect(oversized.response.status).toBe(413);
    expect(oversized.response.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(oversized.body)).not.toContain(secret);
  });

  it("rejects unsupported methods with a route-specific Allow header", async () => {
    const apiDelete = await worker.fetch(request("/api/totp", { method: "DELETE" }));
    expect(apiDelete.status).toBe(405);
    expect(apiDelete.headers.get("allow")).toBe("GET, HEAD, POST, OPTIONS");
    expect(apiDelete.headers.get("cache-control")).toContain("no-store");
    expect(apiDelete.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    await expect(apiDelete.json()).resolves.toEqual({ error: "method not allowed" });

    const homePost = await worker.fetch(request("/", { method: "POST" }));
    expect(homePost.status).toBe(405);
    expect(homePost.headers.get("allow")).toBe("GET, HEAD, OPTIONS");

    const tokPut = await worker.fetch(request(`/tok/${RFC_SHA1_SECRET_BASE32}`, { method: "PUT" }));
    expect(tokPut.status).toBe(405);
    expect(tokPut.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  });

  it("returns preflight and not-found responses", async () => {
    const apiOptions = await worker.fetch(request("/api/totp", { method: "OPTIONS" }));
    expect(apiOptions.status).toBe(204);
    expect(apiOptions.headers.get("allow")).toBe("GET, HEAD, POST, OPTIONS");
    expect(apiOptions.headers.get("cache-control")).toContain("no-store");
    expect(apiOptions.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");

    const homeOptions = await worker.fetch(request("/", { method: "OPTIONS" }));
    expect(homeOptions.status).toBe(204);
    expect(homeOptions.headers.get("allow")).toBe("GET, HEAD, OPTIONS");

    const tokOptions = await worker.fetch(request(`/tok/${RFC_SHA1_SECRET_BASE32}`, { method: "OPTIONS" }));
    expect(tokOptions.status).toBe(204);
    expect(tokOptions.headers.get("allow")).toBe("GET, HEAD, OPTIONS");

    const missing = await json("/missing");
    expect(missing.response.status).toBe(404);
    expect(missing.response.headers.get("cache-control")).toContain("no-store");
    expect(missing.response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(missing.body).toEqual({ error: "not found" });
  });

  it("rate limits token endpoints with Retry-After while pages stay unaffected", async () => {
    const blockedEnv: TestEnv = { TOTP_RATE_LIMITER: { limit: async () => ({ success: false }) } };

    const api = await json(`/api/totp?secret=${RFC_SHA1_SECRET_BASE32}&time=59&digits=8`, undefined, blockedEnv);
    expect(api.response.status).toBe(429);
    expect(api.body).toEqual({ error: "rate limit exceeded, retry later" });
    expect(api.response.headers.get("retry-after")).toBe("10");
    expect(api.response.headers.get("cache-control")).toContain("no-store");
    expect(api.response.headers.get("strict-transport-security")).toBe("max-age=31536000");

    const tok = await json(`/tok/${RFC_SHA1_SECRET_BASE32}?time=59&digits=8`, undefined, blockedEnv);
    expect(tok.response.status).toBe(429);
    expect(tok.body).toEqual({ error: "rate limit exceeded, retry later" });
    expect(tok.response.headers.get("retry-after")).toBe("10");

    const home = await worker.fetch(request("/"), blockedEnv);
    expect(home.status).toBe(200);

    const health = await worker.fetch(request("/healthz"), blockedEnv);
    expect(health.status).toBe(200);
  });

  it("keys rate limiting by the connecting IP with an unknown fallback", async () => {
    const seenKeys: string[] = [];
    const env: TestEnv = {
      TOTP_RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          seenKeys.push(key);
          return { success: true };
        },
      },
    };

    await worker.fetch(
      request(`/api/totp?secret=${RFC_SHA1_SECRET_BASE32}&time=59`, { headers: { "cf-connecting-ip": "203.0.113.9" } }),
      env,
    );
    await worker.fetch(request(`/tok/${RFC_SHA1_SECRET_BASE32}?time=59`), env);

    expect(seenKeys).toEqual(["203.0.113.9", "unknown"]);
  });

  it("serves tokens when the rate limiter allows requests or fails open", async () => {
    const allowingEnv: TestEnv = { TOTP_RATE_LIMITER: { limit: async () => ({ success: true }) } };
    const allowed = await json(`/tok/${RFC_SHA1_SECRET_BASE32}?time=59&digits=8`, undefined, allowingEnv);
    expect(allowed.response.status).toBe(200);
    expect(allowed.body).toEqual({ token: "94287082" });

    const failingEnv: TestEnv = {
      TOTP_RATE_LIMITER: {
        limit: async () => {
          throw new Error("limiter unavailable");
        },
      },
    };
    const failOpen = await json(`/api/totp?secret=${RFC_SHA1_SECRET_BASE32}&time=59&digits=8`, undefined, failingEnv);
    expect(failOpen.response.status).toBe(200);
    expect(failOpen.body).toMatchObject({ token: "94287082" });
  });

  it("does not echo an invalid secret in error responses", async () => {
    const secret = "NOT-A-VALID-SECRET!";
    const { body, response } = await json(`/api/totp?secret=${encodeURIComponent(secret)}&time=59`);

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(JSON.stringify(body)).not.toContain(secret);
  });
});
