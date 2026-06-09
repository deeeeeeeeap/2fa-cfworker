import { describe, expect, it } from "vitest";
import worker from "../src/index";

const RFC_SHA1_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://totp.example.test${path}`, init);
}

async function json(path: string, init?: RequestInit): Promise<{ body: any; response: Response }> {
  const response = await worker.fetch(request(path, init));
  return { body: await response.json(), response };
}

describe("Worker routes", () => {
  it("serves the local-browser UI with cacheable HTML and CSP", async () => {
    const response = await worker.fetch(request("/"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toContain("public");
    expect(response.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-[^']+'/);
    expect(response.headers.get("content-security-policy")).toContain("object-src 'none'");
    expect(body).toContain("即时生成 TOTP 验证码");
    expect(body).toContain("JSON API");
    expect(body).toContain("仅用于测试和自动化用途");
    expect(body).toContain("https://github.com/deeeeeeeeap/2fa-cfworker");
    expect(body).toContain("新代码将在 <b>--</b> 秒后生成");
    expect(body).toContain("rel=\"icon\" type=\"image/png\" sizes=\"192x192\" href=\"/favicon.png\"");
    expect(body).toContain("rel=\"shortcut icon\" type=\"image/png\" href=\"/favicon.ico\"");
    expect(body).toContain("rel=\"apple-touch-icon\" sizes=\"192x192\" href=\"/apple-touch-icon.png\"");
    expect(body).toContain("class=\"brand-logo\"");
    expect(body).toContain("class=\"cf-logo\"");
    expect(body).toContain("id=\"token\" class=\"token\" type=\"button\"");
    expect(body).toContain("aria-label=\"点击复制验证码\"");
    expect(body).toContain("class=\"inline-icon totp-icon\"");
    expect(body).toContain("class=\"inline-icon code-icon\"");
    expect(body).toContain("class=\"button-icon totp-icon\"");
    expect(body).toContain("class=\"label-icon braces-icon\"");
    expect(body).toContain("class=\"totp-asset\"");
    expect(body).toContain("class=\"code-asset\"");
    expect(body).toContain("class=\"database-asset\"");
    expect(body).toContain("class=\"warning-mark\"");
    expect(body).not.toContain("● GitHub");
    expect(body).not.toContain("↯");
    expect(body).not.toContain("GitHub ↗");
    expect(body).not.toContain(">▢</button>");
    expect(body).not.toContain(">△<");
    expect(body).not.toContain(">ϟ<");
    expect(body).not.toContain(">▣<");
    expect(body).not.toContain("class=\"globe\"");
    expect(body).not.toContain("hero-art left");
    expect(body).not.toContain("class=\"dots\"");
    expect(body).not.toContain("class=\"cloud");
    expect(body).not.toContain("hero-shield");
    expect(body).not.toContain("mix-blend-mode");
    expect(body).not.toContain("result-shield");
    expect(body).not.toContain("id=\"copyOtp\"");
    expect(body).not.toContain("已复制");
    expect(body).not.toContain("result-meta");
    expect(body).not.toContain("meta-cell");
    expect(body).not.toContain("颁发者示例");
    expect(body).not.toContain("issuer@example.com");
    expect(body).not.toContain("账户示例");
  });

  it("serves the app favicon as an actual image route", async () => {
    for (const path of ["/favicon.ico", "/favicon.png", "/apple-touch-icon.png"]) {
      const response = await worker.fetch(request(path));
      const bytes = new Uint8Array(await response.arrayBuffer());

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/png");
      expect(response.headers.get("cache-control")).toContain("public");
      expect(bytes.length).toBeGreaterThan(1000);
      expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    }
  });

  it("returns health and robots responses", async () => {
    await expect(json("/healthz")).resolves.toMatchObject({ body: { ok: true } });

    const robots = await worker.fetch(request("/robots.txt"));
    await expect(robots.text()).resolves.toContain("Disallow: /");
    expect(robots.headers.get("cache-control")).toContain("public");
  });

  it("returns a 2fa.live-compatible /tok response", async () => {
    const { body, response } = await json(`/tok/${RFC_SHA1_SECRET_BASE32}?time=59&digits=8`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toEqual({ token: "94287082" });
  });

  it("returns metadata for GET and POST /api/totp", async () => {
    const getResult = await json(`/api/totp?secret=${RFC_SHA1_SECRET_BASE32}&time=59&digits=8`);
    expect(getResult.body).toMatchObject({
      token: "94287082",
      period: 30,
      remaining: 1,
      digits: 8,
      algorithm: "SHA1",
      counter: "1",
    });

    const postResult = await json("/api/totp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: RFC_SHA1_SECRET_BASE32, time: 59, digits: 8 }),
    });
    expect(postResult.body).toMatchObject({ token: "94287082", counter: "1" });
  });

  it("handles malformed and oversized JSON as client errors without echoing secrets", async () => {
    const malformed = await json("/api/totp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.response.status).toBe(400);
    expect(malformed.body.error).toBe("request body must be valid JSON");

    const secret = "A".repeat(3000);
    const oversized = await json("/api/totp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    expect(oversized.response.status).toBe(413);
    expect(JSON.stringify(oversized.body)).not.toContain(secret);
  });

  it("rejects unsupported methods with a route-specific Allow header", async () => {
    const response = await worker.fetch(request("/api/totp", { method: "DELETE" }));
    const body = await response.json();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST, OPTIONS");
    expect(body).toEqual({ error: "method not allowed" });
  });

  it("returns preflight and not-found responses", async () => {
    const options = await worker.fetch(request("/api/totp", { method: "OPTIONS" }));
    expect(options.status).toBe(204);
    expect(options.headers.get("allow")).toBe("GET, POST, OPTIONS");

    const missing = await json("/missing");
    expect(missing.response.status).toBe(404);
    expect(missing.body).toEqual({ error: "not found" });
  });

  it("does not echo an invalid secret in error responses", async () => {
    const secret = "NOT-A-VALID-SECRET!";
    const { body, response } = await json(`/api/totp?secret=${encodeURIComponent(secret)}&time=59`);

    expect(response.status).toBe(400);
    expect(JSON.stringify(body)).not.toContain(secret);
  });
});
