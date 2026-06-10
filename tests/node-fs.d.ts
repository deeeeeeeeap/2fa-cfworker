// Minimal ambient declarations so the Node-pool tests can use node:fs without
// pulling @types/node into a WebWorker-lib project.
declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: string): string;
  export function readdirSync(path: string | URL, options: { recursive: true; encoding?: string }): string[];
}
