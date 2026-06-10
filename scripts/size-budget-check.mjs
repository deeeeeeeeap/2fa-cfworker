import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const maxGzipKiB = Number(process.env.MAX_GZIP_KIB ?? "64");
const outdir = "bundled";
const command = process.platform === "win32" ? "cmd.exe" : "npx";
const args =
  process.platform === "win32"
    ? ["/d", "/s", "/c", `npx wrangler deploy --outdir ${outdir} --dry-run`]
    : ["wrangler", "deploy", "--outdir", outdir, "--dry-run"];

rmSync(outdir, { recursive: true, force: true });

const result = spawnSync(command, args, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
process.stdout.write(output);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const match = output.match(/gzip:\s*([\d.]+)\s*(KiB|MiB)/i);
if (!match) {
  console.error("Could not parse gzip bundle size from Wrangler dry-run output.");
  process.exit(1);
}

const value = Number(match[1]);
const unit = match[2].toLowerCase();
const gzipKiB = unit === "mib" ? value * 1024 : value;

if (gzipKiB > maxGzipKiB) {
  console.error(`Bundle gzip size ${gzipKiB.toFixed(2)} KiB exceeds budget ${maxGzipKiB} KiB.`);
  process.exit(1);
}

console.log(`Bundle gzip size ${gzipKiB.toFixed(2)} KiB is within budget ${maxGzipKiB} KiB.`);
