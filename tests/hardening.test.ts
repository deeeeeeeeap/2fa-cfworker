import { describe, expect, it } from "vitest";
import worker, { rateLimitKey } from "../src/index";

const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://totp.example.test${path}`, init);
}

function keyFor(headers: Record<string, string>): string {
  return rateLimitKey(request("/api/totp", { headers }));
}

function post(body: BodyInit, contentType = "application/json"): Promise<Response> {
  return worker.fetch(request("/api/totp", { method: "POST", headers: { "content-type": contentType }, body }));
}

describe("rate limit keys", () => {
  it("groups IPv6 clients by /64 and keeps IPv4 clients per address", () => {
    const base = keyFor({ "cf-connecting-ip": "2001:db8:1234:5678::1" });

    expect(base).toBe("ip6:2001:db8:1234:5678::/64");
    expect(keyFor({ "cf-connecting-ip": "2001:db8:1234:5678:aaaa:bbbb:cccc:dddd" })).toBe(base);
    expect(keyFor({ "cf-connecting-ip": "2001:0DB8:1234:5678:0000:0000:0000:0001" })).toBe(base);
    expect(keyFor({ "cf-connecting-ip": "2001:db8:1234:5679::1" })).not.toBe(base);
    expect(keyFor({ "cf-connecting-ip": "203.0.113.9" })).toBe("ip4:203.0.113.9");
    expect(keyFor({ "cf-connecting-ip": "::ffff:203.0.113.9" })).toBe("ip4:203.0.113.9");
    expect(keyFor({})).toBe("ip:unknown");
  });

  it("prefers CF-Connecting-IPv6 over a pseudo IPv4 address", () => {
    const key = keyFor({ "cf-connecting-ip": "240.16.0.1", "cf-connecting-ipv6": "2001:db8:1234:5678::99" });

    expect(key).toBe("ip6:2001:db8:1234:5678::/64");
  });
});

describe("strict input parsing", () => {
  it("rejects coerced numeric parameters instead of reading them as 0", async () => {
    for (const time of [" ", "0x10", "1e3", "false"]) {
      const response = await worker.fetch(request(`/api/totp?secret=${SECRET}&time=${encodeURIComponent(time)}`));
      expect(response.status, JSON.stringify(time)).toBe(400);
    }
    for (const time of [[], false, " "]) {
      const response = await post(JSON.stringify({ secret: SECRET, time }));
      expect(response.status, JSON.stringify(time)).toBe(400);
    }

    const valid = await post(JSON.stringify({ secret: SECRET, time: 59, digits: "8" }));
    await expect(valid.json()).resolves.toMatchObject({ token: "94287082" });
  });

  it("accepts only SHA1, SHA256 and SHA512 algorithm names", async () => {
    for (const algorithm of ["sha256", "SHA-512", "sha-1"]) {
      const response = await post(JSON.stringify({ secret: SECRET, time: 59, algorithm }));
      expect(response.status, algorithm).toBe(200);
    }
    for (const algorithm of ["SHA3", "md5", ["SHA1"], 1]) {
      const response = await post(JSON.stringify({ secret: SECRET, time: 59, algorithm }));
      expect(response.status, JSON.stringify(algorithm)).toBe(400);
    }
  });

  it("reports an over-long secret as a 400 parameter error", async () => {
    const response = await worker.fetch(request(`/api/totp?secret=${"A".repeat(300)}`));

    expect(response.status).toBe(400);
  });

  it("percent-decodes secrets only on the /tok/ path and never case-maps non-ASCII", async () => {
    // JSON and query values arrive already decoded, so "%47" must stay literal.
    const encoded = await post(JSON.stringify({ secret: `%47${SECRET.slice(1)}`, time: 59 }));
    expect(encoded.status).toBe(400);

    // U+017F upper-cases to "S" and must not turn into a valid Base32 letter.
    const unicode = await post(JSON.stringify({ secret: `${SECRET.slice(0, -1)}\u017f`, time: 59 }));
    expect(unicode.status).toBe(400);

    const tok = await worker.fetch(request(`/tok/%47${SECRET.slice(1)}?time=59&digits=8`));
    await expect(tok.json()).resolves.toEqual({ token: "94287082" });

    const badEncoding = await worker.fetch(request("/tok/%E0%A4%A?time=59"));
    expect(badEncoding.status).toBe(400);
  });
});

describe("HTTP semantics", () => {
  it("matches the JSON media type on its essence and advertises it on 415", async () => {
    const valid = await post(JSON.stringify({ secret: SECRET, time: 59 }), "Application/JSON; charset=utf-8");
    expect(valid.status).toBe(200);

    for (const type of ["text/plain; x=application/json", "application/json-patch+json", "text/plain"]) {
      const response = await post(JSON.stringify({ secret: SECRET }), type);
      expect(response.status, type).toBe(415);
      expect(response.headers.get("accept"), type).toBe("application/json");
    }
  });

  it("rejects request bodies that are not valid UTF-8", async () => {
    const encoder = new TextEncoder();
    const body = new Uint8Array([...encoder.encode(`{"secret":"${SECRET}","note":"`), 0xff, ...encoder.encode('"}')]);
    const response = await post(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "request body must be valid JSON" });
  });

  it("sends a CSP with preflight responses", async () => {
    const response = await worker.fetch(request("/api/totp", { method: "OPTIONS" }));

    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
  });
});

describe("page privacy", () => {
  it("clears the secret when the page is hidden for navigation", async () => {
    const html = await (await worker.fetch(request("/"))).text();

    expect(html).toContain('window.addEventListener("pagehide", () => {');
  });

  it("keeps the secret out of the API request example and masks the /tok/ preview", async () => {
    const html = await (await worker.fetch(request("/"))).text();

    expect(html).toContain('<button id="copyCode" class="primary" type="button" aria-disabled="true">');
    expect(html).toContain('const body = { secret: "YOUR_SECRET" };');
    expect(html).toContain('<details id="compat" class="advanced compat">');
    expect(html).toContain('full.replace("/tok/" + secret, "/tok/" + "•".repeat(8))');
    expect(html).toContain('<p id="secret-note" class="field-hint" aria-live="polite" hidden></p>');
  });
});
