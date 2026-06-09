import { describe, expect, it } from "vitest";

declare const require: (module: string) => { readFileSync: (path: URL, encoding: string) => string };

const { readFileSync } = require("fs");

function readText(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("privacy and deployment configuration", () => {
  it("keeps production log settings from persisting secret-bearing URLs", () => {
    const config = readText("wrangler.jsonc");

    expect(config).toContain('"logpush": false');
    expect(config).toContain('"enabled": false');
    expect(config).toContain('"invocation_logs": false');
    expect(config).toContain('"persist": false');
  });

  it("does not add console logging that could expose secrets or tokens", () => {
    const source = readText("src/index.ts");

    expect(source).not.toMatch(/\bconsole\.(log|info|warn|error|debug)\b/);
    expect(source).toContain("Security rule: never log request URLs, request bodies, or decoded secrets.");
  });

  it("documents POST automation and production log privacy", () => {
    const readme = readText("README.md");

    expect(readme).toContain("POST /api/totp");
    expect(readme).toContain("日志隐私");
    expect(readme).toContain("invocation logs");
    expect(readme).toContain("Worker，`wrangler.jsonc` 的 `name` 必须与 Dashboard 中的 Worker 名称一致");
  });
});
