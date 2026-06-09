# Security Notes

TOTP secrets are equivalent to one factor of authentication. Treat them as sensitive data.

Required operational practices:

1. Do not log request URLs, query strings, request bodies, decoded secrets, generated tokens, or user IP+secret pairs.
2. Do not add third-party JavaScript, analytics pixels, ad scripts, external fonts, or remote images to the UI.
3. Prefer browser-local generation or POST bodies over `/tok/<secret>` URL paths.
4. Keep `Cache-Control: no-store` on all token responses.
5. Use a custom domain over HTTPS; Cloudflare Workers provides HTTPS for workers.dev and custom domains, but production should use a domain you control.
6. Disable or restrict any observability/export pipeline that would store full paths or request bodies.
7. Use Cloudflare WAF/rate limiting for public deployments.

Deployment default:

- `wrangler.jsonc` keeps `observability.enabled` set to `false` for safer first deployment.
- Only enable persisted observability after confirming your Cloudflare account, Workers Logs, Logpush, traces, and any SIEM/export destination do not persist URL paths, query strings, request bodies, decoded secrets, generated tokens, or IP+secret pairs.
- Keep `npm run check` green before deploying.
