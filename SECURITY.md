# Security Notes

TOTP secrets are equivalent to one factor of authentication. Treat them as sensitive data.

## Reporting a vulnerability

Please report security problems privately through GitHub's "Report a vulnerability" button on this repository's Security tab (private vulnerability reporting), not in public issues or pull requests. Do not include real TOTP secrets in reports; the RFC 6238 test secrets are enough to reproduce token issues.

## Required operational practices

1. Do not log request URLs, query strings, request bodies, decoded secrets, generated tokens, or user IP+secret pairs.
2. Do not add third-party JavaScript, analytics pixels, ad scripts, external fonts, or remote images to the UI.
3. Prefer browser-local generation or `POST /api/totp` bodies over `/tok/<secret>` URL paths and GET query secrets.
4. Keep `Cache-Control: no-store` on API, token, and error responses. The HTML page uses `no-cache` with an ETag: it is byte-identical for every request (inline script and style are allow-listed by SHA-256 hash, there is no per-request nonce, and it carries no request or user data), and the page clears the secret on `pagehide`, so neither revalidation nor the back/forward cache can expose one. If a per-request nonce is ever reintroduced, the HTML must go back to `no-store`.
5. Use a custom domain over HTTPS; Cloudflare Workers provides HTTPS for workers.dev and custom domains, but production should use a domain you control.
6. Disable or restrict any observability/export pipeline that would store full paths or request bodies. Some channels cannot be switched off by `wrangler.jsonc`:
   - Wrangler >= 4.118 records full request URLs (path and query, so `/tok/<secret>` and `?secret=`) into `.wrangler/state` through local observability, readable from the dev server without authentication. `npm run dev` sets `X_LOCAL_OBSERVABILITY=false`; keep it that way when starting `wrangler dev` by other means.
   - Real-time logs (`wrangler tail`, the Dashboard Live view) include every request URL regardless of `observability.enabled`; control who can see them through account roles.
   - WAF and rate limiting Security Events record request paths and keep them for 31 days.
7. The code ships with a built-in rate limiting binding (see `ratelimits` in `wrangler.jsonc`), keyed per IPv4 address and per IPv6 /64; public deployments must still layer Cloudflare WAF / Rate Limiting rules and usage alerts on top in the Dashboard. Those rules only protect your own zone: `*.workers.dev` and Version URLs bypass them, so production must set both `"workers_dev": false` and `"preview_urls": false`.
8. Keep `X-Robots-Tag: noindex, nofollow, noarchive` on HTML, API, token, and error responses.
9. For browser auto-fill, use the fragment form `/#/tok/<secret>`: the fragment is never sent to the server, and the page clears it from the address bar after reading it. The former `/<secret>` bare-path route has been removed.
10. The API intentionally sends no CORS headers, so cross-origin browser calls fail by design: third-party pages must never be able to read tokens, and secrets should not flow through other origins' frontends. Automate from servers or CLI tools instead; do not "fix" this by adding `Access-Control-Allow-Origin`.

Deployment default:

- `wrangler.jsonc` keeps `observability.enabled`, `observability.logs.invocation_logs`, log persistence, trace persistence, and `logpush` disabled for safer first deployment.
- Only enable persisted observability after confirming your Cloudflare account, Workers Logs, invocation logs, Logpush, traces, and any SIEM/export destination do not persist URL paths, query strings, request bodies, decoded secrets, generated tokens, or IP+secret pairs.
- Keep `npm run check` green before deploying. It includes the static logging guard, tests, Wrangler dry-run, and bundle size budget.
- Prefer `POST /api/totp` for automation. Treat `/tok/<secret>` and `GET /api/totp?secret=...` as compatibility or temporary testing paths only.
