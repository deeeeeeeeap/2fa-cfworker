# Security Notes

TOTP secrets are equivalent to one factor of authentication. Treat them as sensitive data.

Required operational practices:

1. Do not log request URLs, query strings, request bodies, decoded secrets, generated tokens, or user IP+secret pairs.
2. Do not add third-party JavaScript, analytics pixels, ad scripts, external fonts, or remote images to the UI.
3. Prefer browser-local generation or `POST /api/totp` bodies over `/tok/<secret>` URL paths and GET query secrets.
4. Keep `Cache-Control: no-store` on all HTML, API, and token responses while inline CSP nonce scripts are used.
5. Use a custom domain over HTTPS; Cloudflare Workers provides HTTPS for workers.dev and custom domains, but production should use a domain you control.
6. Disable or restrict any observability/export pipeline that would store full paths or request bodies.
7. The code ships with a built-in per-IP rate limiting binding (see `ratelimits` in `wrangler.jsonc`); public deployments must still layer Cloudflare WAF / Rate Limiting rules and usage alerts on top in the Dashboard.
8. Keep `X-Robots-Tag: noindex, nofollow, noarchive` on HTML, API, token, and error responses.
9. For browser auto-fill, use the fragment form `/#/tok/<secret>`: the fragment is never sent to the server, and the page clears it from the address bar after reading it. The former `/<secret>` bare-path route has been removed.
10. The API intentionally sends no CORS headers, so cross-origin browser calls fail by design: third-party pages must never be able to read tokens, and secrets should not flow through other origins' frontends. Automate from servers or CLI tools instead; do not "fix" this by adding `Access-Control-Allow-Origin`.

Deployment default:

- `wrangler.jsonc` keeps `observability.enabled`, `observability.logs.invocation_logs`, log persistence, trace persistence, and `logpush` disabled for safer first deployment.
- Only enable persisted observability after confirming your Cloudflare account, Workers Logs, invocation logs, Logpush, traces, and any SIEM/export destination do not persist URL paths, query strings, request bodies, decoded secrets, generated tokens, or IP+secret pairs.
- Keep `npm run check` green before deploying. It includes the static logging guard, tests, Wrangler dry-run, and bundle size budget.
- Prefer `POST /api/totp` for automation. Treat `/tok/<secret>` and `GET /api/totp?secret=...` as compatibility or temporary testing paths only.
