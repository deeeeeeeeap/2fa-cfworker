import { readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const maxGzipKiB = Number(process.env.MAX_GZIP_KIB ?? "64");
const outdir = "bundled";
// wrangler's "exports" map hides bin/; its package.json (exported) names the CLI.
const wranglerPackage = createRequire(import.meta.url).resolve("wrangler/package.json");
const wranglerBin = join(dirname(wranglerPackage), JSON.parse(readFileSync(wranglerPackage, "utf8")).bin.wrangler);

rmSync(outdir, { recursive: true, force: true });
const result = spawnSync(process.execPath, [wranglerBin, "deploy", "--dry-run", "--outdir", outdir], { stdio: "inherit" });
if (result.status !== 0) {
  console.error(result.error?.message ?? `wrangler deploy --dry-run exited with ${result.status}`);
  process.exit(result.status ?? 1);
}

// Measure the uploaded modules themselves instead of parsing Wrangler's
// human-readable summary, which is not a stable interface.
const modules = readdirSync(outdir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(m?js|cjs|wasm|bin|txt|html)$/.test(entry.name))
  .map((entry) => join(entry.parentPath, entry.name));
if (modules.length === 0) {
  console.error(`No Worker modules found in ${outdir}/.`);
  process.exit(1);
}

let rawBytes = 0;
let gzipBytes = 0;
for (const file of modules) {
  const bytes = readFileSync(file);
  rawBytes += bytes.length;
  gzipBytes += gzipSync(bytes).length;
}
const gzipKiB = gzipBytes / 1024;
const summary = `${modules.length} module(s), ${(rawBytes / 1024).toFixed(2)} KiB raw / ${gzipKiB.toFixed(2)} KiB gzip`;
if (gzipKiB > maxGzipKiB) {
  console.error(`Bundle ${summary} exceeds budget ${maxGzipKiB} KiB.`);
  process.exit(1);
}
console.log(`Bundle ${summary} is within budget ${maxGzipKiB} KiB.`);
