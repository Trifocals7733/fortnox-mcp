# AGENTS.md

Guidance for agents working in this repo. Human-facing docs (install, OAuth setup, env var tables, tool catalogue) live in [README.md](./README.md) — read that first, don't duplicate it here.

## What this is

An MCP server exposing the Fortnox (Swedish accounting) REST API as 51 `fortnox_*` tools. TypeScript, ESM, Node 18+. Personal fork of `jakobwennberg/fortnox-mcp`; **not published anywhere** — no npm, no MCP Registry. Runs locally from `dist/index.js`, or self-hosted internally (planned: own VPS behind Tailscale). Three shapes from one tool registry:

| Shape | Entry | Auth |
|---|---|---|
| stdio (default, local) | `src/index.ts` → `runStdio()` | `FORTNOX_REFRESH_TOKEN` env var, persisted to `~/.fortnox-mcp/tokens.json` |
| local HTTP | `src/index.ts` → `runLocalHTTP()` | same env var, no OAuth |
| remote (self-hosted, multi-user) | `src/server/remote.ts` | OAuth proxy + JWT, per-user tokens in Redis |

Mode is selected by `AUTH_MODE` / `TRANSPORT` in `src/config.ts`.

## Commands

```bash
npm install          # required first; node_modules is not checked in
npm run build        # tsc — this is the ONLY check. No tests, no linter, no formatter.
npm run dev          # tsx watch src/index.ts
npm run clean
```

There is no test suite. `npm run build` passing is the bar for "it works". Don't claim a change is verified beyond that.

No release/publish tooling exists (the upstream `scripts/release.sh` and the `release:*` scripts were removed). Keep it that way unless asked. `server.json` is inert MCP Registry metadata kept for reference — it is not validated or synced by anything.

## Layout

```
src/index.ts              entry; mode dispatch + stdio/local-HTTP servers
src/server/remote.ts      remote Express app; OAuth router, bearer auth, per-request MCP transport
src/config.ts             AUTH_MODE / TRANSPORT / PORT; throws on missing remote vars
src/constants.ts          base URLs, rate limits, page sizes, 25k char response cap
src/tools/<domain>.ts     tool registration — one file per domain, self-contained
src/schemas/<domain>.ts   zod input schemas (snake_case) + inferred input types
src/services/api.ts       fortnoxRequest(), rate limiter, fetchAllPages(), error mapping
src/services/formatters.ts buildToolResponse(), buildErrorResponse(), md money/list/detail helpers
src/services/dateHelpers.ts      period → date range, aging buckets
src/services/aggregationHelpers.ts  stats, growth, groupBy helpers for BI tools
src/auth/                 ITokenProvider (env-var vs database), OAuth proxy provider, AsyncLocalStorage ctx
src/auth/storage/         ITokenStorage: memory | Upstash Redis (`redis.ts`)
scripts/get-token.ts      interactive helper to obtain a local-mode refresh token
fortnox_docs/fortnox_api.json  full Fortnox OpenAPI spec — grep it, don't read it
evaluations/              BI tool QA pairs (manual/XML, not run by any test runner)
```

## Adding or changing a tool

1. Schema in `src/schemas/<domain>.ts`: `z.object({...}).strict()` with `.describe()` on every field, snake_case names, and a `response_format` enum (`ResponseFormat.MARKDOWN` default). Export the inferred `type`.
2. Handler in `src/tools/<domain>.ts` via `server.registerTool(name, { title, description, inputSchema, annotations }, handler)`.
   - Name: `fortnox_<verb>_<noun>`.
   - Description is a literal for the LLM, not JSDoc: `Args:` / `Returns:` / `Examples:` sections. Keep it tight — descriptions are optimized for connect time.
   - `annotations` is required on every tool; get `readOnlyHint` / `destructiveHint` right (deletes and bookkeeping are destructive).
   - Body: map snake_case args → Fortnox's PascalCase query params (`customer_number` → `customernumber`, `search_name` → `name`), `fortnoxRequest<T>(endpoint, method, data, params)`, build a snake_case `output` object, branch on `response_format` (JSON = `JSON.stringify(output, null, 2)`, otherwise a formatter helper), then `return buildToolResponse(text, output)` — never a bare `{ content }`.
   - Wrap the whole body in `try/catch` returning `buildErrorResponse(error)`.
3. **Register it in BOTH places**: `createMcpServer()` in `src/index.ts` and the remote app in `src/server/remote.ts`. They drift silently — tools have shipped missing from remote mode before. If the domain is new, add the `registerXxxTools` call to both.
4. Checks: `npm run build`, and confirm README's tool list stays true.

## API + data conventions

- All Fortnox traffic goes through `fortnoxRequest` / `fetchAllPages` in `src/services/api.ts`. Don't call axios directly from a tool.
- The rate limiter is module-global (25 req / 5 s, in-memory, per process). It does not coordinate across processes, so running several instances multiplies the effective request rate.
- Fortnox returns PascalCase objects (`Invoice`, `MetaInformation["@TotalResources"]`). Declare local `Fortnox*` interfaces per tool file (that's the existing pattern — no shared API type module) and convert to snake_case keys in `output`.
- Pagination: `limit` 1–100 (default 20), `page` from 1. Analytics/BI queries use `fetchAllPages`, which is capped by `MAX_FETCH_ALL_RESULTS` / `MAX_FETCH_ALL_PAGES` and reports `truncated` — surface that, don't drop it.
- Money: `formatMoney` → `sv-SE` with 2 decimals + `SEK`. Dates in and out are `YYYY-MM-DD`; `formatDisplayDate` only for md output.
- Responses are truncated at `CHARACTER_LIMIT` (25 000) in `buildToolResponse`.

## Gotchas

- ESM with `module: Node16`: **every relative import needs a `.js` extension** (`./services/api.js`), even in `.ts` files. CI-free repo, so a missing extension only shows up at runtime or on `tsc`.
- zod v3 — `z.nativeEnum`, not v4 syntax. Schemas are `.strict()`, so new args must be added to the schema or calls fail.
- Look up Fortnox endpoints/fields by grepping `fortnox_docs/fortnox_api.json` (OpenAPI: `paths`, `components.schemas`). It's ~1 MB; never load it whole.
- Remote mode needs `SERVER_URL`, `JWT_SECRET`, `FORTNOX_CLIENT_ID`, `FORTNOX_CLIENT_SECRET`; Redis vars fall back to in-memory storage with a warning (loses tokens on restart).
- Remote mode keeps OAuth client registrations, pending authorizations, issued codes and revocations **in memory** (`oauthProvider.ts`) — it assumes a single long-lived instance behind a reverse proxy. Clustering it would need external state; don't "just add replicas".
- The Express app is bound over plain HTTP; TLS and access control belong to the reverse proxy (Tailscale/WireGuard in the intended setup), not to this code.
- Fortnox refresh tokens are **single-use** — any code that refreshes must persist the new one (`persistTokens`) or the next run is broken. Both providers dedupe concurrent refreshes; keep that.
- Secrets: never log tokens, never commit `.env` (gitignored). User tokens live outside the repo at `~/.fortnox-mcp/tokens.json` (0600).
- `.agents/skills/mcp-builder/` holds MCP server design guidance (tool naming, error message quality, context budget). Read it when adding a new tool domain. It is gitignored — local to this machine, so it may be absent in a fresh clone.
