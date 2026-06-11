# 2FA Worker

一个可部署到 Cloudflare Workers 的无状态 TOTP 验证码生成器。项目提供浏览器 UI、兼容 `2fa.live` 风格的 `/tok/<secret>` 接口，以及更适合自动化集成的 JSON API。

## 特性

- Cloudflare Worker 无状态运行，无数据库、无 KV、无持久化存储依赖。
- 模块化结构：`src/totp-core.ts`（TOTP/HOTP 算法与校验）、`src/page.ts`（首页 UI 模板）、`src/assets.ts`（favicon 资源）、`src/index.ts`（HTTP 路由层）。
- 首页为「时间仪器」风格 TOTP 生成 UI：深浅双主题（跟随系统 + 手动切换）、SVG 轨道时钟插画、逐位验证码单元格与平滑倒计时环；除 favicon 外全部视觉资产为内联 SVG，无外部字体/脚本/图片。
- 支持 `SHA1`、`SHA256`、`SHA512`，验证码位数支持 6-8 位。
- 内置每 IP 限流：`/api/totp` 与 `/tok/*` 默认 20 次 / 10 秒，超限返回 `429`，阈值可在 `wrangler.jsonc` 调整。
- 首页 HTML 与 API 响应默认 `no-store`，HTML 响应带 CSP nonce（script + style）、HSTS 与常见安全响应头；所有 `GET` 路由同时支持 `HEAD`。
- `wrangler.jsonc` 默认关闭 persisted observability、invocation logs 和 Logpush，降低 URL 中 TOTP secret 被记录的风险。
- 内置 RFC 测试向量、路由测试、TypeScript 检查、Wrangler dry-run 和 bundle gzip size budget。

## 路由

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/` | 浏览器 TOTP UI |
| `GET` | `/tok/<BASE32_SECRET>` | 兼容 `2fa.live` 风格，返回 `{"token":"123456"}`；仅作兼容旧工具或临时测试用途 |
| `GET` | `/api/totp?secret=<BASE32_SECRET>` | 返回 token、剩余秒数、算法、周期等 metadata；URL secret 仅建议临时使用 |
| `POST` | `/api/totp` | 推荐的 JSON API，更适合自动化集成，body 示例见下方 |
| `GET` | `/healthz` | 健康检查，返回 `{"ok":true}` |
| `GET` | `/robots.txt` | 禁止爬虫索引 |
| `GET` | `/favicon.ico`、`/favicon.png`、`/apple-touch-icon.png` | favicon 图片路由，响应可缓存（页面其余视觉资产为内联 SVG） |

POST 示例：

```bash
curl -X POST "https://<your-worker>.<your-subdomain>.workers.dev/api/totp" \
  -H "Content-Type: application/json" \
  -d '{"secret":"GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ","period":30,"digits":6,"algorithm":"SHA1"}'
```

`POST /api/totp` 成功响应示例：

```json
{
  "token": "123456",
  "period": 30,
  "remaining": 23,
  "remainingMs": 23125,
  "validUntil": "2026-06-09T01:23:30.000Z",
  "digits": 6,
  "algorithm": "SHA1",
  "counter": "58600000"
}
```

`GET /api/totp` 支持的查询参数与 `POST /api/totp` body 字段一致：`secret`、`period`、`digits`、`algorithm`、`time`、`timestampMs`、`t0`。`time` 为 Unix 秒，`timestampMs` 为 Unix 毫秒；同时提供时优先使用 `timestampMs`。

## 本地开发

要求：

- Node.js `>=22`
- npm
- Cloudflare 账号（仅部署时需要）

安装依赖：

```bash
npm ci
```

启动本地 Worker：

```bash
npm run dev -- --port 8787
```

然后打开：

```text
http://127.0.0.1:8787/
```

运行完整检查：

```bash
npm run check
```

该命令会依次执行：

- `npm run typecheck`
- `npm run test`
- `node scripts/check-vectors.mjs`
- `npm run security`
- `npm run size`（内部会执行 `wrangler deploy --dry-run`）

检查 bundle gzip 体积预算：

```bash
npm run size
```

默认 gzip budget 为 `64 KiB`，可用环境变量调整：

```bash
MAX_GZIP_KIB=128 npm run size
```

Windows PowerShell 下：

```powershell
$env:MAX_GZIP_KIB = "128"; npm run size
```

远端开发模式更接近 Cloudflare 边缘运行环境：

```bash
npm run dev:remote
```

## 通过 Wrangler 部署

1. 登录 Cloudflare：

```bash
npx wrangler login
```

2. 按需修改 `wrangler.jsonc`：

```jsonc
{
  "name": "2fa-cfworker",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-08",
  "workers_dev": true
}
```

如果你在 Cloudflare Dashboard 里已经创建了同名 Worker，`wrangler.jsonc` 的 `name` 必须与 Dashboard 中的 Worker 名称一致。
如果 Dashboard 中的 Worker 名称不同，请先统一 Dashboard 名称或修改 `wrangler.jsonc` 的 `name`，否则 Cloudflare Workers Builds 可能部署到非预期 Worker。

3. 部署前检查：

```bash
npm run check
```

4. 部署：

```bash
npm run deploy
```

部署成功后，默认会发布到：

```text
https://2fa-cfworker.<your-subdomain>.workers.dev/
```

## 通过 GitHub + Cloudflare Workers Builds 部署

此仓库已包含 `wrangler.jsonc` 和 `package-lock.json`，适合直接连接 Cloudflare Workers Builds。
仓库也包含 GitHub Actions CI：每次 push 到 `main` 或 pull request 会运行 `npm ci` 和 `npm run check`。`npm run check` 已包含 typecheck、测试、RFC vectors、日志隐私静态检查、Wrangler dry-run 和 bundle gzip size budget。

Cloudflare Dashboard 推荐配置：

| 配置项 | 建议值 |
| --- | --- |
| Repository | `deeeeeeeeap/2fa-cfworker` |
| Production branch | `main` |
| Root directory | 留空（仓库根目录） |
| Node version | `22` |
| Build command | `npm ci && npm run check` |
| Deploy command | `npm run deploy` |
| Non-production deploy command | 默认即可，或 `npx wrangler versions upload` |

操作路径：

1. Cloudflare Dashboard -> Workers & Pages -> Create application。
2. 选择 Import a repository。
3. 选择 `deeeeeeeeap/2fa-cfworker`。
4. 确认 `wrangler.jsonc` 中的 `name` 与 Cloudflare Worker 名称一致。
5. 保存并部署。后续推送到 `main` 会触发自动构建和部署。

> 注意：`wrangler.jsonc` 的 Worker 名为 `2fa-cfworker`，与 Cloudflare Dashboard 中的 Worker 名称保持一致。如果你的 Dashboard Worker 使用其他名称，请先把 `wrangler.jsonc` 的 `name` 改成同名后再部署。

## 自定义域名

如果要绑定自定义域名，可以把 `wrangler.jsonc` 调整为类似：

```jsonc
{
  "workers_dev": false,
  "routes": [
    { "pattern": "2fa.example.com", "custom_domain": true }
  ]
}
```

不要把真实域名、token、cookie 或私钥写进仓库。

## 安全说明

- 优先使用首页 UI 或 `POST /api/totp`。
- `/tok/<secret>` 和 `GET /api/totp?secret=...` 会把 secret 放在 URL 中，只建议兼容旧工具或临时测试。
- 浏览器自动填入请使用 `/#/tok/<secret>` fragment 形式：fragment 不会发送到服务器，页面读取后会自动清理地址栏；此前的 `/<secret>` 裸路径已移除。
- 不要开启会记录 URL path、query、body、decoded secret 或 generated token 的日志、分析、追踪、Logpush 或第三方可观测性管道。
- `wrangler.jsonc` 默认关闭 persisted observability、invocation logs、trace persistence 和 Logpush；如果你确认自己的日志管道不会保存敏感字段，再按需开启。
- 不需要 Cloudflare KV、D1、R2 或其他数据库绑定。
- 代码已内置 Rate Limiting binding（每 IP 20 次 / 10 秒，每个 Cloudflare 节点独立计数）；公开部署仍必须在 Cloudflare Dashboard 为 `/api/totp` 和 `/tok/*` 叠加 WAF / Rate Limiting 与用量告警；如果仅自用，建议考虑 Cloudflare Access。

### 生产日志隐私检查清单

URL 中携带的 TOTP secret 可能出现在浏览器历史、截图、反向代理日志、Cloudflare Workers invocation logs、Logpush、Tail Workers、第三方 APM 或 SIEM 中。生产部署前请确认：

- 不记录 `request.url`、path、query、request body、decoded secret、generated token 或 IP+secret 组合。
- 如需开启 Cloudflare observability，必须保持 `observability.logs.invocation_logs = false`，并确认日志不会持久化或导出敏感字段。
- 自动化调用优先使用 `POST /api/totp`，避免把 secret 放进 URL。
- 不把真实 secret、token、cookie、API key 写入 README、测试、Issue、PR、提交信息、截图或日志。

## 最终部署前检查

推荐在部署前按顺序执行：

```bash
npm ci
npm run check
npm run size
git diff --check
npm run deploy:dry-run
```

本地 HTTP smoke test：

```bash
npm run dev -- --port 8787
curl -i http://127.0.0.1:8787/healthz
curl -i http://127.0.0.1:8787/robots.txt
curl -i -X POST "http://127.0.0.1:8787/api/totp" \
  -H "Content-Type: application/json" \
  -d '{"secret":"GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ","period":30,"digits":6,"algorithm":"SHA1"}'
```

部署后至少确认：

- 首页可打开且 HTML 响应为 `Cache-Control: no-store, max-age=0`。
- `/healthz` 返回 `{"ok":true}`。
- `/api/totp` 与 `/tok/<BASE32_SECRET>` 响应包含 `X-Robots-Tag: noindex, nofollow, noarchive`。
- Cloudflare Dashboard 没有启用会持久保存 URL、query、body、secret 或 token 的日志导出。

## Troubleshooting

| 问题 | 处理方式 |
| --- | --- |
| Node 版本错误 | 使用 Node.js 22 或更高版本。Cloudflare Workers Builds 里显式设置 Node version 为 `22`。 |
| `npm ci` 提示 lockfile 不一致 | 在本地运行 `npm install` 更新 `package-lock.json`，确认 `npm run check` 通过后再提交。 |
| Wrangler 未登录 | 本地部署前运行 `npx wrangler login`；CI/Workers Builds 使用 Cloudflare 平台授权，不要把 token 写进仓库。 |
| 部署到错误 Worker | 检查 `wrangler.jsonc` 的 `name` 是否与 Cloudflare Dashboard 中目标 Worker 名称一致。 |
| Workers Builds 配置错误 | 推荐 `Build command: npm ci && npm run check`，`Deploy command: npm run deploy`，Node version `22`。 |
| API 返回 invalid secret | 确认 secret 为 Base32 字符 `A-Z` 和 `2-7`；空格、连字符和末尾 `=` 可自动忽略，其他特殊字符不支持。 |

## 项目结构

```text
.
├── src/index.ts                  # Worker 入口：HTTP 路由、安全响应头、限流
├── src/totp-core.ts              # TOTP/HOTP 算法与输入校验
├── src/page.ts                   # 首页 UI 模板（主题系统、CSS、客户端 JS、内联 SVG、HTML）
├── src/assets.ts                 # favicon 资源与图片路由映射
├── tests/                        # Vitest 路由、TOTP、客户端漂移与隐私配置测试
├── scripts/check-vectors.mjs     # RFC 测试向量交叉验证（独立参考实现）
├── scripts/security-guard.mjs    # 日志隐私静态检查
├── scripts/size-budget-check.mjs # Wrangler dry-run gzip size budget
├── .github/workflows/ci.yml      # GitHub Actions CI
├── .github/dependabot.yml        # 依赖每周更新
├── vitest.config.ts              # 测试池配置（CI 在 workerd 运行时执行）
├── wrangler.jsonc                # Cloudflare Workers 配置（含 Rate Limiting binding）
├── package.json                  # npm scripts 与 devDependencies
└── SECURITY.md                   # 安全使用说明
```

## 常用命令

```bash
npm ci
npm run dev -- --port 8787
npm run typecheck
npm run test
npm run deploy:dry-run
npm run size
npm run check
npm run deploy
```

## 参考文档

- [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)
