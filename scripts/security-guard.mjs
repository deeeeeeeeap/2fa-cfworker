import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const srcDir = "src";
const files = readdirSync(srcDir, { recursive: true })
  .filter((entry) => entry.endsWith(".ts"))
  .map((entry) => join(srcDir, entry))
  .sort();

const bannedPatterns = [
  {
    pattern: /\bconsole\.(log|info|warn|error|debug)\s*\(/,
    reason: "Worker source must not add console logging that may capture URL secrets.",
  },
  {
    pattern: /\bconsole\.(log|info|warn|error|debug)[\s\S]{0,160}\b(request\.url|url\.href|searchParams|secret|token|body)\b/i,
    reason: "Never log request URLs, query strings, request bodies, secrets, or generated tokens.",
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

if (failed) {
  process.exit(1);
}

console.log("Security guard passed: no secret-bearing logging patterns found.");
