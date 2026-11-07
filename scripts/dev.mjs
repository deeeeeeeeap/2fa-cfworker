import { spawnSync } from "node:child_process";

// Wrangler >= 4.118 records full request URLs (including /tok/<secret> and
// ?secret=) into .wrangler/state via local observability unless opted out.
const env = { ...process.env, X_LOCAL_OBSERVABILITY: process.env.X_LOCAL_OBSERVABILITY ?? "false" };
const args = ["wrangler", "dev", ...process.argv.slice(2)];
const result =
  process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", `npx ${args.join(" ")}`], { stdio: "inherit", env })
    : spawnSync("npx", args, { stdio: "inherit", env });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
