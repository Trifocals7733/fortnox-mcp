> **WIP — not a usable product yet.**
# Fortnox MCP Server

An MCP ([Model Context Protocol](https://modelcontextprotocol.io)) server for the Fortnox Swedish accounting API. It exposes customers, invoices, suppliers, supplier invoices, orders, accounts, vouchers and a set of analytics/BI tools as typed tool calls, so an agent can read and write Fortnox data without knowing the REST API.

Personal fork of [jakobwennberg/fortnox-mcp](https://github.com/jakobwennberg/fortnox-mcp), adapted for internal self-hosted use. **Not published anywhere** — no npm package, no MCP Registry entry. Clone it, build it, run it from `dist/`.

## Requirements

- Node.js **22 or newer**
- A Fortnox developer account with a registered app (Client ID + Client Secret + a refresh token)

Built with TypeScript 7 (the native `tsc`). No build tooling beyond that.

## Install

```bash
git clone https://github.com/Trifocals7733/fortnox-mcp.git
cd fortnox-mcp
npm install
npm run build
```

The entry point is `dist/index.js`. Reference it by absolute path in your MCP client config — there is no global install and no `npx`.

## Configuration

Copy `.env.example` to `.env` and fill it in: `npm start`, `npm run dev` and `npm run get-token` load it automatically via Node's `--env-file-if-exists` (no `dotenv`). Environment variables already set in the shell take precedence over the file.

### Local mode (default)

| Variable | Required | Description |
|----------|----------|-------------|
| `FORTNOX_CLIENT_ID` | Yes | Your Fortnox app client ID |
| `FORTNOX_CLIENT_SECRET` | Yes | Your Fortnox app client secret |
| `FORTNOX_REFRESH_TOKEN` | Yes | OAuth2 refresh token (only needed for initial setup — it is persisted after first use) |
| `FORTNOX_ACCESS_TOKEN` | No | Current access token (auto-refreshed) |
| `FORTNOX_SCOPE` | No | Scope string recorded alongside the token |
| `TRANSPORT` | No | `stdio` (default) or `http` |
| `PORT` | No | HTTP port (default: 3000) |

### Remote mode (`AUTH_MODE=remote`)

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTH_MODE` | Yes | Set to `remote` |
| `SERVER_URL` | Yes | Public URL of this server; used as the OAuth issuer |
| `JWT_SECRET` | Yes | Secret for signing JWT access tokens (`openssl rand -hex 32`) |
| `FORTNOX_CLIENT_ID` | Yes | Your Fortnox app client ID |
| `FORTNOX_CLIENT_SECRET` | Yes | Your Fortnox app client secret |
| `UPSTASH_REDIS_REST_URL` | No* | Redis URL for per-user token storage (`KV_REST_API_URL` also accepted) |
| `UPSTASH_REDIS_REST_TOKEN` | No* | Redis token (`KV_REST_API_TOKEN` also accepted) |
| `TOKEN_STORAGE` | No | `upstash-redis` (default when Redis vars are set) or `memory` |
| `PORT` | No | HTTP port (default: 3000) |

*Without Redis the server falls back to in-memory storage and warns: tokens are lost on restart, so that is dev-only.

### Getting credentials

1. Register at the [Fortnox Developer Portal](https://developer.fortnox.se) and create an application to get a **Client ID** and **Client Secret**.
2. Obtain a refresh token with `npm run get-token` (needs `FORTNOX_CLIENT_ID` and `FORTNOX_CLIENT_SECRET` set). It opens a browser flow and prints the refresh token.
3. Put the three values in the `env` block of your MCP client config.

Scopes requested: `companyinformation`, `customer`, `invoice`, `supplier`, `supplierinvoice`, `order`, `offer`, `bookkeeping`, `project`, `costcenter` — one per API area the tools call. Fortnox gates some of these on the subscription's licences (`order`/`offer` need the Order module), and a missing scope shows up as a 400 "Har inte behörighet för scope" when that tool is called, not at startup. Requesting fewer scopes is fine, that tool just fails.

### Token persistence (local mode)

Fortnox refresh tokens are single-use — every refresh returns a new one. The server keeps the latest in `~/.fortnox-mcp/tokens.json` (created `0600`), so restarts don't need config edits:

- The first run reads `FORTNOX_REFRESH_TOKEN` from the environment.
- After each refresh, the new refresh token replaces the one in that file.
- On restart the persisted token wins; if the file is missing or corrupt, the env var is used.

## Running

### stdio (Claude Desktop and most MCP clients)

Add to your client config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "fortnox": {
      "command": "node",
      "args": ["/absolute/path/to/fortnox-mcp/dist/index.js"],
      "env": {
        "FORTNOX_CLIENT_ID": "your-client-id",
        "FORTNOX_CLIENT_SECRET": "your-client-secret",
        "FORTNOX_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

### Local HTTP

```bash
TRANSPORT=http PORT=3000 node dist/index.js
```

Connect to `http://localhost:3000/mcp`. `GET /health` reports liveness.

### Remote mode (self-hosted, multi-user)

Remote mode puts the same tools behind an OAuth proxy: MCP clients authenticate against this server, and the server holds each user's Fortnox tokens itself, so nobody pastes a refresh token into their client config.

1. Set `AUTH_MODE=remote`, `SERVER_URL`, `JWT_SECRET` and the Fortnox client credentials on the host.
2. Configure Redis, or accept in-memory storage for single-user/dev.
3. In your Fortnox app settings, register the redirect URI `${SERVER_URL}/oauth/fortnox/callback`.
4. Run `node dist/index.js` behind a reverse proxy and point clients at `${SERVER_URL}/mcp`.

Clients discover the flow the standard MCP way: `GET /.well-known/oauth-authorization-server` → `POST /authorize` → Fortnox consent → `GET /oauth/fortnox/callback` → `POST /token` → authenticated `POST /mcp`.

Operational notes:

- Client registrations, pending authorizations, issued codes and revocations are held **in memory**, so run a **single instance**. A restart means clients re-authorize once.
- The server binds plain HTTP; TLS, hostnames and access control belong to the reverse proxy (Tailscale/WireGuard rather than the open internet).
- Fortnox tokens live in Redis per user with a 90-day TTL; the JWTs this server issues expire after an hour.

## Tools

51 tools, all prefixed `fortnox_`. Every tool accepts `response_format`: `markdown` (default, human/LLM readable) or `json` (structured `structuredContent`).

| Area | Tools |
|------|-------|
| Customers | `list_customers`, `get_customer`, `create_customer`, `update_customer`, `delete_customer` |
| Invoices | `list_invoices`, `get_invoice`, `create_invoice`, `update_invoice`, `bookkeep_invoice`, `cancel_invoice`, `credit_invoice`, `send_invoice_email` |
| Suppliers | `list_suppliers`, `get_supplier`, `create_supplier`, `update_supplier`, `delete_supplier` |
| Supplier invoices | `list_supplier_invoices`, `get_supplier_invoice`, `approve_supplier_invoice`, `payables_report` |
| Orders | `list_orders`, `list_offers` |
| Accounts | `list_accounts`, `get_account`, `create_account`, `update_account`, `delete_account` |
| Vouchers | `list_vouchers`, `get_voucher`, `create_voucher`, `list_voucher_series`, `account_activity`, `search_vouchers` |
| Company | `get_company_info`, `list_financial_years` |
| Analytics | `invoice_summary`, `top_customers`, `unpaid_report` |
| Business intelligence | `cash_flow_forecast`, `order_pipeline`, `sales_funnel`, `product_performance`, `period_comparison`, `customer_growth`, `project_profitability`, `cost_center_analysis`, `expense_analysis`, `yearly_comparison`, `gross_margin_trend` |

The authoritative list, including every input schema, is `test/tools-baseline.json` — regenerate it with `npm run snapshot:tools`.

## Development

```bash
npm run dev            # tsx watch src/index.ts
npm run build          # tsc -> dist/
npm run clean          # rm -rf dist
npm run snapshot:tools # rewrite test/tools-baseline.json from the server
npm run check:tools    # diff the advertised tool surface, exit 1 on drift
npm run smoke          # live read-only calls against the real Fortnox account
npm run company        # list/switch the authorised Fortnox company
```

`npm run company` keeps one token per company under `~/.fortnox-mcp/` and
switches which one is active — useful for pointing the server at a test
company without redoing the OAuth flow:

```bash
npm run company                  # what is active, what is archived
npm run company -- save 1888108  # archive the active token
npm run company -- use 1865351   # make an archive active
```

There is no test suite and no linter. `npm run build` plus `npm run check:tools` is what "works" means for the code; `npm run smoke` is what "works" means against a real account — it drives a dozen read-only tools over an in-memory MCP client and exits 1 on any failure. The 51-tool `tools/list` output is frozen in `test/tools-baseline.json` so a refactor that drops a tool, an argument or a description shows up as a diff. Neither needs a Fortnox token except `smoke`.

Adding tools: see [AGENTS.md](./AGENTS.md) for the codebase map and the conventions to follow.

## Limits

The Fortnox API allows 25 requests per 5 seconds; outgoing calls pass through a sliding-window gate that keeps the server under that, with automatic retry and exponential backoff on 429/5xx. The gate is in-process, so it does not coordinate across several instances.

Long analytics queries page through results with a delay, capped at 10 000 items / 100 pages, with truncation reported in the response. Tool responses are truncated at 25 000 characters.

## API reference

`fortnox_docs/openapi.json` is the current Fortnox OpenAPI specification (285 paths, 680 schemas). Grep it for endpoint and field names rather than loading it whole.

## License

MIT — see [LICENSE](./LICENSE). Original work © Jakob Wennberg.
