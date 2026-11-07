// Minimal ambient declarations so the Node-pool tests can use node:fs without
// pulling @types/node into a WebWorker-lib project.
// The Workers runtime types do not declare import.meta.url, which the
// Node-pool tests use to resolve repository files.
interface ImportMeta {
  readonly url: string;
}

declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: string): string;
  export function readdirSync(path: string | URL, options: { recursive: true; encoding?: string }): string[];
}
