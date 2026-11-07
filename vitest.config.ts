import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

// Worker tests can run inside the real workerd runtime via
// @cloudflare/vitest-plugin, opted in with VITEST_WORKERS_POOL=1 (enabled in CI).
//
// It is opt-in because the plugin's module-fallback service breaks
// when the project path contains spaces or non-ASCII characters
// (https://github.com/cloudflare/workers-sdk/issues/5268); on such paths the
// same tests transparently fall back to the Node pool.
//
// The privacy-config and client-drift tests always run in the Node pool: they
// need node:fs and dynamic code evaluation, neither of which belongs in the
// workerd sandbox.
const WORKER_TESTS = ["tests/totp.test.ts", "tests/worker-fetch.test.ts", "tests/hardening.test.ts"];
const useWorkersPool = process.env.VITEST_WORKERS_POOL === "1";

export default defineConfig({
  test: {
    projects: [
      useWorkersPool
        ? {
            plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
            test: {
              name: "workers",
              include: WORKER_TESTS,
            },
          }
        : {
            test: {
              name: "worker-node",
              environment: "node",
              include: WORKER_TESTS,
            },
          },
      {
        test: {
          name: "node",
          environment: "node",
          include: ["tests/privacy-config.test.ts", "tests/client-drift.test.ts"],
        },
      },
    ],
  },
});
