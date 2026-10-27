> **WIP — not a usable product yet.**

# Fortnox MCP Server

[![check](https://github.com/Trifocals7733/fortnox-mcp/actions/workflows/check.yml/badge.svg)](https://github.com/Trifocals7733/fortnox-mcp/actions/workflows/check.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node: >=22](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-server-purple.svg)](https://modelcontextprotocol.io)

An MCP server for the [Fortnox](https://www.fortnox.se) Swedish accounting API. It exposes customers, invoices, suppliers, supplier invoices, orders, accounts, vouchers and a set of analytics tools as 51 typed tool calls, so an agent can read and write Fortnox data without knowing the REST API.

A personal fork of [jakobwennberg/fortnox-mcp](https://github.com/jakobwennberg/fortnox-mcp), substantially rebuilt — see [Changes from upstream](#changes-from-upstream). Not published anywhere: no npm package, no MCP Registry entry. Clone it, build it, run it.

| | |
|---|---|
| **Tools** | 51, every one with an input schema and a declared output schema |
| **Transport** | stdio (default) or HTTP |
| **Auth** | one Fortnox refresh token per process |
| **Runtime** | Node ≥ 22, TypeScript 7, Effect 4 |
| **Dependencies** | `@modelcontextprotocol/{server,node,client}`, `effect`, `express` |

## Highlights

- **Everything is schema-typed end to end.** Tool inputs and outputs are Effect schemas, bridged to the MCP SDK's `StandardSchemaWithJSON`; the advertised `tools/list` surface is frozen in a test so it cannot drift silently.
- **One Effect runtime** owns the HTTP client, retry/backoff, the 25 req/5 s rate limiter and the token provider.
- **Tested against a real Fortnox account**, including writes: create/update/delete, voucher balancing, invoice bookkeep and credit.
- **~25k tokens per connect**, down from 127k, with the tool surface and its schemas intact.

## Tools

51 tools, all prefixed `fortnox_`. Every one accepts `response_format`: `markdown` (default, for reading) or `json` (validated `structuredContent`).

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

The authoritative list, including every schema, is [`test/tools-baseline.json`](./test/tools-baseline.json) — regenerate with `npm run snapshot:tools`.

A few tools are honest about being partial: `project_profitability`, `cost_center_analysis`, `expense_analysis` and `gross_margin_trend` return structure rather than full figures and say so in their descriptions (Fortnox needs voucher analysis by dimension for the real numbers).

## Requirements

- Node.js **22 or newer**
- A Fortnox developer account with a registered app (Client ID, Client Secret, and one refresh token)

## Install

```bash
git clone https://github.com/Trifocals7733/fortnox-mcp.git
cd fortnox-mcp
npm install
npm run build
```

The entry point is `dist/index.js`. Reference it by absolute path in your MCP client config — there is no global install and no `npx`.

## Configuration

Copy `.env.example` to `.env` and fill it in. `npm start`, `npm run dev` and `npm run get-token` load it automatically with Node's `--env-file-if-exists` — no `dotenv` dependency. Environment variables already set in the shell win.

| Variable | Required | Description |
|----------|----------|-------------|
| `FORTNOX_CLIENT_ID` | Yes | Fortnox app client ID |
| `FORTNOX_CLIENT_SECRET` | Yes | Fortnox app client secret |
| `FORTNOX_REFRESH_TOKEN` | Yes | OAuth2 refresh token (initial setup only — it is persisted after first use) |
| `FORTNOX_ACCESS_TOKEN` | No | Current access token (auto-refreshed) |
| `FORTNOX_SCOPE` | No | Scope string recorded alongside the token |
| `TRANSPORT` | No | `stdio` (default) or `http` |
| `PORT` | No | HTTP port (default: 3000) |

### Getting a refresh token

1. Register at the [Fortnox Developer Portal](https://developer.fortnox.se) and create an application to get a **Client ID** and **Client Secret**.
2. Run `npm run get-token`. It prints an authorization URL, listens on `localhost:8888` for the callback, exchanges the code, and persists the refresh token to `~/.fortnox-mcp/tokens.json`.
3. Register `http://localhost:8888/callback` as a redirect URI on your Fortnox app, or the flow will error.

Scopes requested by the helper: `companyinformation`, `customer`, `invoice`, `supplier`, `supplierinvoice`, `order`, `offer`, `bookkeeping`, `project`, `costcenter` — one per API area the tools call. Fortnox gates some behind subscription licences (`order`/`offer` need the Order module), and a missing scope shows up as a `400 Har inte behörighet för scope` on that tool, not at startup.

### Token persistence

Fortnox refresh tokens are **single-use**: every refresh returns a new one. The server keeps the latest in `~/.fortnox-mcp/tokens.json` (`0600`), which takes precedence over `.env`, so restarts need no config edits. If that file is missing or corrupt, the env var is used.

### Switching companies

`npm run company` keeps one token per Fortnox company and switches which one is active — handy for aiming the server at a test company without redoing the OAuth flow:

```bash
npm run company                  # what is active, what is archived
npm run company -- save 1888108  # archive the active token
npm run company -- use 1865351   # make an archive active
```

It refuses to overwrite an active token that has not been archived, because a rotated refresh token cannot be recovered.

## Running

### stdio — Claude Desktop and most MCP clients

`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows:

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

### HTTP — agents on another machine

```bash
TRANSPORT=http PORT=3000 node dist/index.js
```

Point clients at `http://<host>:3000/mcp`; `GET /health` reports liveness.

> **There is no authentication on the HTTP transport.** The network is the access control — run it behind Tailscale or WireGuard, never on a public interface. One Fortnox token per process: this is a single-user server by design.

## Development

```bash
npm run dev            # tsx watch src/index.ts
npm run build          # tsc -> dist/
npm run clean          # rm -rf dist
npm run lint           # biome check (format + lint)
npm run format         # biome check --write
npm run test           # structure tests: no credentials, no network
npm run test:live      # everything that needs the API; writes to Fortnox
npm run check          # build + lint + test + tool-surface drift
npm run check:tools    # diff the advertised tool surface against the baseline
npm run snapshot:tools # accept a deliberate surface change
npm run get-token      # interactive OAuth helper for a refresh token
npm run company        # list/switch authorised Fortnox companies
```

### Verification

Three tiers, in increasing cost:

| Command | Needs | Covers |
|---|---|---|
| `npm run test` | nothing | tool surface vs baseline, every tool has schemas and annotations, the Effect→MCP bridge validates, list outputs accept both response shapes, the rate limiter throttles |
| `npm run check:tools` | nothing | the frozen 51-tool surface: a dropped tool, argument or description fails |
| `npm run test:live` | `FORTNOX_TEST_COMPANY` + a token | 49 of the 51 tools against a real company — read-only matrix plus customer/supplier/account/voucher/invoice lifecycles, including bookkeep and credit. The two exceptions are the tools blocked on Fortnox UI settings (see [Limitations](#limitations)) |

`npm run test:live` refuses to run unless the connected company matches `FORTNOX_TEST_COMPANY`, because it writes. It cleans up after itself, except invoices — those cannot be deleted, only cancelled or credited.

CI runs `npm run check` on every push and pull request. `test:live` stays manual.

## Changes from upstream

The upstream project was a working Fortnox MCP server. This fork rebuilt it: **46 commits across 82 files** (+51.7k/−28.8k lines including the lockfile), with *fewer* source lines (11.8k → 10.9k) and considerably more capability.

**Runtime and dependencies**

- **TypeScript 7** (the native Go compiler), no declaration emit, `engines` ≥ 22, `exactOptionalPropertyTypes` on.
- **MCP SDK v1 → v2**: `@modelcontextprotocol/sdk` is gone; the server uses `@modelcontextprotocol/server`, `@modelcontextprotocol/node` and `@modelcontextprotocol/client`.
- **Effect 4** replaces the ad-hoc plumbing: `effect/http` instead of axios, retry/backoff via `Schedule`, one `ManagedRuntime`, a hand-built 25 req/5 s limiter (Effect 4 dropped the `RateLimiter` module), and the token provider behind a `Layer`.
- **zod removed entirely.** Tool inputs *and* outputs are Effect schemas; a small bridge adds the `~standard.jsonSchema` half the SDK needs. All 51 tools declare an `outputSchema`, so `structuredContent` is validated before the client sees it.
- **axios removed** — including in OAuth token refresh, which is where a silent bug lurked: `HttpClientRequest.bodyText()` attaches no body in a pipe, so the first version sent an empty form and the refresh would have broken an hour after startup.

**Behaviour and surface**

- **Fortnox `-v2` endpoints** for invoices, orders and offers, verified payload-compatible before switching (same envelope and keys; v2 adds a `Bundle` flag on invoice rows).
- **Tool descriptions cut 27.6k → 6.3k chars** and normalised: what the tool is for plus the trap that matters, with the duplicated `Args:`/`Returns:` blocks gone (the schemas already carry them). `tools/list` fell from 127k to ~100k chars (≈25k tokens) per connect.
- **Fortnox's stringly-typed fields are coerced.** `DeliveredQuantity` is a string, supplier-invoice `Total` is a string, `Balance` is a number on detail but a string on list, `Credit` is the string `"false"`, and `DatabaseNumber` is a number despite the spec. Each was found by running against a real account, not by reading the docs.
- **`send_invoice_email` was broken** — it sent `PUT` where Fortnox documents `GET`.

**Removed**

- **Remote mode, entirely** (~870 lines): the multi-user OAuth proxy, authorization server, JWT minting, per-user token storage in Redis and the `AsyncLocalStorage` request context. It was the only code on a package the SDK deprecates, it had never been driven through a browser flow, and the intended deployment — own agents behind Tailscale — gets reachability from the network rather than from OAuth. Gone with it: `jose`, `@upstash/redis`, `@modelcontextprotocol/server-legacy`.
- **Publishing and deployment scaffolding**: `api/index.ts`, `vercel.json`, `scripts/release.sh`, the npm/MCP-Registry release scripts, `server.json`, and all the npm/`npx` install paths.

**Engineering**

- **Biome** for format and lint. Not ESLint: `typescript-eslint` requires TypeScript < 6.1 and this repo is on 7, whose package no longer exposes a compiler API — so type-aware rules are unavailable here, not merely unconfigured.
- **A test suite** (`node:test`, no new dependencies) and a **live suite** against a real account, plus a **GitHub Actions workflow** that runs the gate on every push.
- **A frozen tool surface** (`test/tools-baseline.json`) so drift is a diff, not a surprise.

## Limitations

- **`approve_supplier_invoice`** needs *betalattestering* (payment approval) enabled on the company; **`send_invoice_email`** needs a bank account under **Register → Transaktionskonton** (a name plus bankgiro, or IBAN + BIC). Both are Fortnox UI settings that need BankID to change, and the API cannot set them — `/3/settings/company` is read-only. Until they are set, both tools fail with a Fortnox message (`Inställningen för betalattestering är avstängd`, `Bankuppgifter saknas`) rather than doing anything surprising.
- The four analytics tools noted above return structure, not full figures.
- Collections built by aggregation helpers are declared as opaque arrays: a guessed element schema would only look right while the array is empty.
- Reads and writes are verified against a test company with a financial year, but no agent has used these 51 tools for real work yet. Descriptions and output shapes are optimised against what a client can measure, not against what an agent actually picks.

## API reference

`fortnox_docs/openapi.json` is the current Fortnox OpenAPI specification (285 paths, 680 schemas). Grep it for endpoints and fields rather than loading it whole.

## License

MIT — see [LICENSE](./LICENSE). Original work © Jakob Wennberg; this fork's changes are under the same licence.
