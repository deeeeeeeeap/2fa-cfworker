import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const srcDir = "src";
const files = readdirSync(srcDir, { recursive: true })
  .filter((entry) => /\.(ts|js|mjs|css)$/.test(entry))
  .map((entry) => join(srcDir, entry))
  .sort();

// Any reference to the identifier is banned, not just console.log(...):
// console.trace, console["log"], destructured methods and globalThis.console
// all slipped past a call-pattern check.
const bannedPatterns = [
  {
    pattern: /\bconsole\b/,
    reason: "Worker and client source must not reference console at all; logs can capture URL secrets.",
  },
];

let failed = false;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const { pattern, reason } of bannedPatterns) {
    if (pattern.test(text)) {
      console.error(`Security guard failed in ${file}: ${reason}`);
      failed = true;
    }
  }
}

// A Tail Worker receives every request URL, including /tok/<secret>.
const wranglerConfig = readFileSync("wrangler.jsonc", "utf8");
if (/"tail_consumers"\s*:/.test(wranglerConfig)) {
  console.error("Security guard failed in wrangler.jsonc: tail_consumers would forward request URLs (and URL secrets).");
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log("Security guard passed: no logging references or URL-forwarding consumers found.");
