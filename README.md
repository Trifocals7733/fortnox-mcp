# Fortnox MCP Server

An MCP ([Model Context Protocol](https://modelcontextprotocol.io)) server for the Fortnox Swedish accounting API. It exposes invoices, customers, suppliers, orders, accounts, vouchers and a set of analytics/BI tools so that LLM agents can read and write Fortnox data through typed tool calls.

Fork of [jakobwennberg/fortnox-mcp](https://github.com/jakobwennberg/fortnox-mcp), adapted for internal self-hosted use. Not published to npm or the MCP Registry — clone, build, run from `dist/`.

## Modes

| Mode | Transport | Auth | Use case |
|------|-----------|------|----------|
| **Local** (default) | stdio | Fortnox OAuth2 refresh token from env | One user, agent spawns the process |
| **Local HTTP** | HTTP | Same env token | Local testing, multiple clients |
| **Remote** | HTTP | OAuth proxy + JWT, per-user tokens in Redis | Self-hosted, multi-user, behind a reverse proxy |

Mode is selected with `AUTH_MODE` and `TRANSPORT` (see [Configuration](#configuration)).

## Features

### Customer Management
- `fortnox_list_customers` - List and search customers
- `fortnox_get_customer` - Get customer details
- `fortnox_create_customer` - Create new customer
- `fortnox_update_customer` - Update customer
- `fortnox_delete_customer` - Delete customer

### Invoice Management
- `fortnox_list_invoices` - List invoices with filtering
- `fortnox_get_invoice` - Get invoice details with line items
- `fortnox_create_invoice` - Create new invoice
- `fortnox_update_invoice` - Update draft invoice
- `fortnox_bookkeep_invoice` - Bookkeep invoice
- `fortnox_cancel_invoice` - Cancel invoice
- `fortnox_credit_invoice` - Create credit note
- `fortnox_send_invoice_email` - Send invoice by email

### Supplier Management
- `fortnox_list_suppliers` - List and search suppliers
- `fortnox_get_supplier` - Get supplier details
- `fortnox_create_supplier` - Create new supplier
- `fortnox_update_supplier` - Update supplier
- `fortnox_delete_supplier` - Delete supplier

### Supplier Invoice Management
- `fortnox_list_supplier_invoices` - List supplier invoices with filtering
- `fortnox_get_supplier_invoice` - Get supplier invoice details
- `fortnox_approve_supplier_invoice` - Approve supplier invoice for payment
- `fortnox_payables_report` - Get accounts payable aging report

### Order Management
- `fortnox_list_orders` - List sales orders with filtering
- `fortnox_list_offers` - List offers/quotes with filtering

### Account Management
- `fortnox_list_accounts` - List chart of accounts
- `fortnox_get_account` - Get account details
- `fortnox_create_account` - Create new account
- `fortnox_update_account` - Update account
- `fortnox_delete_account` - Delete account

### Voucher Management
- `fortnox_list_vouchers` - List vouchers (journal entries)
- `fortnox_get_voucher` - Get voucher details with rows
- `fortnox_create_voucher` - Create manual voucher
- `fortnox_list_voucher_series` - List available voucher series
- `fortnox_account_activity` - Get activity for a specific account
- `fortnox_search_vouchers` - Search vouchers by description, account, or amount

### Company Information
- `fortnox_get_company_info` - Get company details
- `fortnox_list_financial_years` - List company financial years

### Analytics
- `fortnox_invoice_summary` - Get invoice statistics by period
- `fortnox_top_customers` - Get top customers by revenue
- `fortnox_unpaid_report` - Get detailed unpaid invoice report

### Business Intelligence
- `fortnox_cash_flow_forecast` - Forecast cash flow based on invoices and payables
- `fortnox_order_pipeline` - Analyze sales order pipeline
- `fortnox_sales_funnel` - Analyze sales funnel from offers to invoices
- `fortnox_product_performance` - Analyze product/article performance
- `fortnox_period_comparison` - Compare financial metrics across periods
- `fortnox_customer_growth` - Analyze customer acquisition and growth
- `fortnox_project_profitability` - Analyze project profitability (if using projects)
- `fortnox_cost_center_analysis` - Analyze costs by cost center
- `fortnox_expense_analysis` - Analyze expenses by category
- `fortnox_yearly_comparison` - Compare year-over-year performance
- `fortnox_gross_margin_trend` - Track gross margin trends over time

## Installation

Build from source. Node 18+ required.

```bash
git clone https://github.com/Trifocals7733/fortnox-mcp.git
cd fortnox-mcp
npm install
npm run build
```

The entry point is `dist/index.js`. Reference it by absolute path in your MCP client config — there is no global install, no `npx`, and nothing published to a registry.

### Getting Fortnox credentials

1. Register as a developer at [Fortnox Developer Portal](https://developer.fortnox.se)
2. Create an application to get a **Client ID** and **Client Secret**
3. Complete the OAuth2 authorization flow to obtain a **refresh token** — `npm run get-token` walks you through it (`FORTNOX_CLIENT_ID` and `FORTNOX_CLIENT_SECRET` must be set)
4. Put the three values in the `env` block of your MCP client config

Scopes requested: `companyinformation`, `customer`, `invoice`, `supplier`, `bookkeeping`.

## Configuration

### Local mode (default)

| Variable | Required | Description |
|----------|----------|-------------|
| `FORTNOX_CLIENT_ID` | Yes | Your Fortnox app client ID |
| `FORTNOX_CLIENT_SECRET` | Yes | Your Fortnox app client secret |
| `FORTNOX_REFRESH_TOKEN` | Yes | OAuth2 refresh token (only needed for initial setup; automatically persisted after first use) |
| `FORTNOX_ACCESS_TOKEN` | No | Current access token (auto-refreshed) |
| `FORTNOX_SCOPE` | No | Scope string to record alongside the token |
| `TRANSPORT` | No | `stdio` (default) or `http` |
| `PORT` | No | HTTP port (default: 3000) |

### Remote mode (`AUTH_MODE=remote`)

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTH_MODE` | Yes | Set to `remote` |
| `SERVER_URL` | Yes | Public URL of this server; used as the OAuth issuer |
| `JWT_SECRET` | Yes | Secret for signing JWT access tokens |
| `FORTNOX_CLIENT_ID` | Yes | Your Fortnox app client ID |
| `FORTNOX_CLIENT_SECRET` | Yes | Your Fortnox app client secret |
| `UPSTASH_REDIS_REST_URL` | No* | Redis URL for per-user token storage (`KV_REST_API_URL` also accepted) |
| `UPSTASH_REDIS_REST_TOKEN` | No* | Redis token (`KV_REST_API_TOKEN` also accepted) |
| `TOKEN_STORAGE` | No | `upstash-redis` (default when Redis vars are set) or `memory` |
| `PORT` | No | HTTP port (default: 3000) |

*Without Redis the server falls back to in-memory storage and logs a warning: tokens are lost on restart, so this is dev-only.

### Token persistence (local mode)

Fortnox refresh tokens are single-use — every refresh returns a new one. The server persists the latest refresh token to `~/.fortnox-mcp/tokens.json` (created `0600`) so restarts don't require editing your config:

- First run reads `FORTNOX_REFRESH_TOKEN` from the environment
- After each refresh, the new refresh token replaces the one in `~/.fortnox-mcp/tokens.json`
- On restart the persisted token wins; if the file is missing or corrupt, the env var is used

## Usage

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

Then connect to `http://localhost:3000/mcp`. `GET /health` reports liveness.

### Remote mode (self-hosted, multi-user)

Remote mode wraps the same tools behind an OAuth proxy: MCP clients authenticate against this server, and the server holds each user's Fortnox tokens itself. Nobody needs to paste a refresh token into their client config.

1. Set `AUTH_MODE=remote`, `SERVER_URL`, `JWT_SECRET` (`openssl rand -hex 32`) and the Fortnox client credentials on the host
2. Configure Redis, or accept in-memory storage for a single-user/dev setup
3. In your Fortnox app settings, register the redirect URI `${SERVER_URL}/oauth/fortnox/callback`
4. Run `node dist/index.js` behind a reverse proxy and point clients at `${SERVER_URL}/mcp`

Clients discover the flow through standard MCP authorization: `GET /.well-known/oauth-authorization-server` → `POST /authorize` → Fortnox consent → `GET /oauth/fortnox/callback` → `POST /token` → authenticated `POST /mcp`.

Operational notes:
- Client registrations, pending authorizations, issued codes and revocations are held in memory, so run a **single instance**. A restart means clients re-authorize once.
- Port is bound in plain HTTP; TLS, hostnames and access control are the reverse proxy's job (put it behind Tailscale/WireGuard rather than the open internet).
- Fortnox tokens live in Redis keyed per user with a 90-day TTL; the JWTs this server issues expire after 1 hour and refresh with the Fortnox token.

## Tool Examples

### List Unpaid Invoices
```json
{
  "tool": "fortnox_list_invoices",
  "arguments": {
    "filter": "unpaid",
    "limit": 20
  }
}
```

### Create Invoice
```json
{
  "tool": "fortnox_create_invoice",
  "arguments": {
    "customer_number": "1001",
    "rows": [
      {
        "description": "Consulting services",
        "quantity": 10,
        "price": 1000
      }
    ]
  }
}
```

### Create Voucher
```json
{
  "tool": "fortnox_create_voucher",
  "arguments": {
    "voucher_series": "A",
    "description": "Office supplies",
    "transaction_date": "2025-01-24",
    "rows": [
      { "account_number": 6110, "debit": 500 },
      { "account_number": 1910, "credit": 500 }
    ]
  }
}
```

## Rate Limiting

The Fortnox API allows 25 requests per 5 seconds. The server throttles every outgoing request to stay under that. The limiter is in-process, so it does not coordinate across several instances of this server.

Long analytics queries page through results with a delay between requests, and are capped (10 000 items / 100 pages) with truncation reported in the response.

## Development

```bash
npm run dev     # tsx watch src/index.ts
npm run build   # tsc -> dist/
npm run clean   # rm -rf dist
```

There is no test suite or linter; `npm run build` is the check.

See [AGENTS.md](./AGENTS.md) for the codebase layout and the conventions to follow when adding tools.

## License

MIT — see [LICENSE](./LICENSE). Original work © Jakob Wennberg.
