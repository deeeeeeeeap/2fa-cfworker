import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

function readText(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

/**
 * Strips line and block comments from JSONC with a string-aware,
 * character-by-character scan so comment markers inside string literals
 * (for example URLs) are preserved.
 */
function stripJsonComments(source: string): string {
  let output = "";
  let index = 0;
  let inString = false;

  while (index < source.length) {
    const char = source[index];

    if (inString) {
      output += char;
      if (char === "\\" && index + 1 < source.length) {
        output += source[index + 1];
        index += 2;
        continue;
      }
      if (char === '"') inString = false;
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      index += 1;
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }

    if (char === "/" && source[index + 1] === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 2;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function readWranglerConfig(): any {
  return JSON.parse(stripJsonComments(readText("wrangler.jsonc")));
}

function listSourceFiles(): string[] {
  return readdirSync(new URL("../src", import.meta.url), { recursive: true })
    .map((name) => String(name).replaceAll("\\", "/"))
    .filter((name) => name.endsWith(".ts"));
}

describe("privacy and deployment configuration", () => {
  it("keeps Workers observability and log persistence disabled", () => {
    const config = readWranglerConfig();

    expect(config.logpush).toBe(false);
    expect(config.observability.enabled).toBe(false);
    expect(config.observability.logs.enabled).toBe(false);
    expect(config.observability.logs.invocation_logs).toBe(false);
    expect(config.observability.logs.persist).toBe(false);
    expect(config.observability.traces.enabled).toBe(false);
    expect(config.observability.traces.persist).toBe(false);
  });

  it("declares the TOTP rate limiter binding", () => {
    const config = readWranglerConfig();
    const [limiter] = config.ratelimits;

    expect(limiter.name).toBe("TOTP_RATE_LIMITER");
    expect(limiter.simple.limit).toBeGreaterThan(0);
    // Must equal RATE_LIMIT_PERIOD_SECONDS in src/index.ts: the 429
    // Retry-After header is derived from that constant, so changing the
    // wrangler period alone would silently mislead clients.
    expect(limiter.simple.period).toBe(10);
    expect(readText("src/index.ts")).toContain("const RATE_LIMIT_PERIOD_SECONDS = 10;");
  });

  it("keeps every src/ module free of console logging and permissive CORS", () => {
    const files = listSourceFiles();
    expect(files).toEqual(expect.arrayContaining(["assets.ts", "index.ts", "page.ts", "totp-core.ts"]));

    for (const name of files) {
      const source = readText(`src/${name}`);
      expect(source, name).not.toMatch(/\bconsole\.(log|info|warn|error|debug)\b/);
      expect(source, name).not.toContain('"Access-Control-Allow-Origin": "*"');
      expect(source, name).not.toContain("'Access-Control-Allow-Origin': '*'");
    }

    expect(readText("src/index.ts")).toContain(
      "Security rule: never log request URLs, request bodies, or decoded secrets.",
    );
  });

  it("keeps the security and size budget scripts wired into package.json", () => {
    const pkg = readText("package.json");

    expect(pkg).toContain("npm run security");
    expect(pkg).toContain("npm run size");
  });

  it("documents POST automation and log privacy in the README", () => {
    const readme = readText("README.md");

    expect(readme).toContain("POST /api/totp");
    expect(readme).toContain("日志隐私");
    expect(readme).toContain("invocation logs");
    expect(readme).toContain("WAF / Rate Limiting");
    expect(readme).toContain("Troubleshooting");
  });
});
