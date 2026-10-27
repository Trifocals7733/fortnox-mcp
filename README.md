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

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORTNOX_CLIENT_ID` | Yes | Your Fortnox app client ID |
| `FORTNOX_CLIENT_SECRET` | Yes | Your Fortnox app client secret |
| `FORTNOX_REFRESH_TOKEN` | Yes | OAuth2 refresh token (only needed for initial setup — it is persisted after first use) |
| `FORTNOX_ACCESS_TOKEN` | No | Current access token (auto-refreshed) |
| `FORTNOX_SCOPE` | No | Scope string recorded alongside the token |
| `TRANSPORT` | No | `stdio` (default) or `http` |
| `PORT` | No | HTTP port (default: 3000) |

### Getting credentials

1. Register at the [Fortnox Developer Portal](https://developer.fortnox.se) and create an application to get a **Client ID** and **Client Secret**.
2. Obtain a refresh token with `npm run get-token` (needs `FORTNOX_CLIENT_ID` and `FORTNOX_CLIENT_SECRET` set). It opens a browser flow and prints the refresh token.
3. Put the three values in the `env` block of your MCP client config.

Scopes requested: `companyinformation`, `customer`, `invoice`, `supplier`, `supplierinvoice`, `order`, `offer`, `bookkeeping`, `project`, `costcenter` — one per API area the tools call. Fortnox gates some of these on the subscription's licences (`order`/`offer` need the Order module), and a missing scope shows up as a 400 "Har inte behörighet för scope" when that tool is called, not at startup. Requesting fewer scopes is fine, that tool just fails.

### Token persistence

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

### HTTP (agents on another machine)

Same tools and the same single Fortnox token, reachable over HTTP instead of a
pipe:

```bash
TRANSPORT=http PORT=3000 node dist/index.js
```

Point agents at `http://<host>:3000/mcp`; `GET /health` reports liveness. There
is no authentication of its own — the network is the access control, so run it
behind Tailscale or WireGuard rather than on a public interface. One instance
per process: the rate limiter and the token live in-process.

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
npm run test           # unit/structure tests: no credentials, no network
npm run test:live      # lifecycle tests that WRITE; needs FORTNOX_TEST_COMPANY
npm run lint           # biome check (format + lint)
npm run check          # build + lint + test + tool-surface drift
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

`npm run check` is the gate: it compiles, lints, runs the test suite and diffs the advertised tool surface against `test/tools-baseline.json`, so a refactor that drops a tool, an argument or a description fails.

Three layers of verification, in increasing cost:

- `npm run test` — structure only, no credentials: the tool surface, that every tool has schemas and annotations, that the Effect→MCP bridge validates, that list outputs accept both response shapes, and that the rate limiter throttles.
- `npm run smoke` — a dozen read-only tools against whatever company the token points at.
- `npm run test:live` — the only suite that **writes**. It needs `FORTNOX_TEST_COMPANY` and refuses to run unless the connected company matches, then exercises customer/supplier/account/voucher/invoice lifecycles (bookkeep and credit included) on that company.

`npm run wipe` doesn't exist — live tests clean up after themselves, but invoices cannot be deleted, only cancelled or credited.

Adding tools: see [AGENTS.md](./AGENTS.md) for the codebase map and the conventions to follow.

## Limits

The Fortnox API allows 25 requests per 5 seconds; outgoing calls pass through a sliding-window gate that keeps the server under that, with automatic retry and exponential backoff on 429/5xx. The gate is in-process, so it does not coordinate across several instances.

Long analytics queries page through results with a delay, capped at 10 000 items / 100 pages, with truncation reported in the response. Tool responses are truncated at 25 000 characters.

## API reference

`fortnox_docs/openapi.json` is the current Fortnox OpenAPI specification (285 paths, 680 schemas). Grep it for endpoint and field names rather than loading it whole.

## License

MIT — see [LICENSE](./LICENSE). Original work © Jakob Wennberg.
