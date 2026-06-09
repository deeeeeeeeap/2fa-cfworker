# 2FA Worker

一个可部署到 Cloudflare Workers 的无状态 TOTP 验证码生成器。项目提供浏览器 UI、兼容 `2fa.live` 风格的 `/tok/<secret>` 接口，以及更适合自动化集成的 JSON API。

## 特性

- Cloudflare Worker 单文件运行，无数据库、无 KV、无持久化存储依赖。
- 首页提供蓝白风格 TOTP 生成 UI，支持实时验证码、倒计时、接口预览和复制。
- 支持 `SHA1`、`SHA256`、`SHA512`，验证码位数支持 6-8 位。
- 首页 HTML 与 API 响应默认 `no-store`，HTML 响应带 CSP nonce 与常见安全响应头。
- `wrangler.jsonc` 默认关闭 persisted observability、invocation logs 和 Logpush，降低 URL 中 TOTP secret 被记录的风险。
- 内置 RFC 测试向量、路由测试、TypeScript 检查、Wrangler dry-run 和 bundle gzip size budget。

## 路由

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/` | 浏览器 TOTP UI |
| `GET` | `/tok/<BASE32_SECRET>` | 兼容 `2fa.live` 风格，返回 `{"token":"123456"}`；仅建议兼容旧工具或临时测试 |
| `GET` | `/api/totp?secret=<BASE32_SECRET>` | 返回 token、剩余秒数、算法、周期等 metadata；URL secret 仅建议临时使用 |
| `POST` | `/api/totp` | 推荐的 JSON API，更适合自动化集成，body 示例见下方 |
| `GET` | `/healthz` | 健康检查，返回 `{"ok":true}` |
| `GET` | `/robots.txt` | 禁止爬虫索引 |

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
- `npm run deploy:dry-run`

检查 bundle gzip 体积预算：

```bash
npm run size
```

默认 gzip budget 为 `512 KiB`，可用环境变量调整：

```bash
MAX_GZIP_KIB=768 npm run size
```

## 通过 Wrangler 部署

1. 登录 Cloudflare：

```bash
npx wrangler login
```

2. 按需修改 `wrangler.jsonc`：

```jsonc
{
  "name": "totp-worker",
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
https://totp-worker.<your-subdomain>.workers.dev/
```

## 通过 GitHub + Cloudflare Workers Builds 部署

此仓库已包含 `wrangler.jsonc` 和 `package-lock.json`，适合直接连接 Cloudflare Workers Builds。
仓库也包含 GitHub Actions CI：每次 push 到 `main` 或 pull request 会运行 `npm ci`、`npm run check` 和 `npm run size`。

Cloudflare Dashboard 推荐配置：

| 配置项 | 建议值 |
| --- | --- |
| Repository | `deeeeeeeeap/2fa-cfworker` |
| Production branch | `main` |
| Root directory | 留空（仓库根目录） |
| Build command | 留空 |
| Deploy command | `npm run deploy` |
| Non-production deploy command | 默认即可，或 `npx wrangler versions upload` |

操作路径：

1. Cloudflare Dashboard -> Workers & Pages -> Create application。
2. 选择 Import a repository。
3. 选择 `deeeeeeeeap/2fa-cfworker`。
4. 确认 `wrangler.jsonc` 中的 `name` 与 Cloudflare Worker 名称一致。
5. 保存并部署。后续推送到 `main` 会触发自动构建和部署。

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
- 不要开启会记录 URL path、query、body、decoded secret 或 generated token 的日志、分析、追踪、Logpush 或第三方可观测性管道。
- `wrangler.jsonc` 默认关闭 persisted observability、invocation logs、trace persistence 和 Logpush；如果你确认自己的日志管道不会保存敏感字段，再按需开启。
- 不需要 Cloudflare KV、D1、R2 或其他数据库绑定。

### 生产日志隐私检查清单

URL 中携带的 TOTP secret 可能出现在浏览器历史、截图、反向代理日志、Cloudflare Workers invocation logs、Logpush、Tail Workers、第三方 APM 或 SIEM 中。生产部署前请确认：

- 不记录 `request.url`、path、query、request body、decoded secret、generated token 或 IP+secret 组合。
- 如需开启 Cloudflare observability，必须保持 `observability.logs.invocation_logs = false`，并确认日志不会持久化或导出敏感字段。
- 自动化调用优先使用 `POST /api/totp`，避免把 secret 放进 URL。
- 不把真实 secret、token、cookie、API key 写入 README、测试、Issue、PR、提交信息、截图或日志。

## 项目结构

```text
.
├── src/index.ts                 # Worker 入口、TOTP 算法、API、首页 UI
├── tests/                       # Vitest 路由与 TOTP 测试
├── scripts/check-vectors.mjs    # RFC 测试向量检查
├── scripts/size-budget-check.mjs # Wrangler dry-run gzip size budget
├── .github/workflows/ci.yml      # GitHub Actions CI
├── wrangler.jsonc               # Cloudflare Workers 配置
├── package.json                 # npm scripts 与 devDependencies
└── SECURITY.md                  # 安全使用说明
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
