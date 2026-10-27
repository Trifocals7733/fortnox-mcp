# AGENTS.md

Guidance for agents working in this repo. Human-facing docs (install, OAuth setup, env var tables, tool catalogue) live in [README.md](./README.md) — read that first, don't duplicate it here.

## What this is

An MCP server exposing the Fortnox (Swedish accounting) REST API as 51 `fortnox_*` tools. TypeScript, ESM, Node 22+. Personal fork of `jakobwennberg/fortnox-mcp`; **not published anywhere** — no npm, no MCP Registry. Runs locally from `dist/index.js`, or self-hosted internally (planned: own VPS behind Tailscale). Three shapes from one tool registry:

| Shape | Entry | Auth |
|---|---|---|
| stdio (default, local) | `src/index.ts` → `runStdio()` | `FORTNOX_REFRESH_TOKEN` env var, persisted to `~/.fortnox-mcp/tokens.json` |
| local HTTP | `src/index.ts` → `runLocalHTTP()` | same env var, no OAuth |
| remote (self-hosted, multi-user) | `src/server/remote.ts` | OAuth proxy + JWT, per-user tokens in Redis |

Mode is selected by `AUTH_MODE` / `TRANSPORT` in `src/config.ts`.

## Commands

```bash
npm install          # required first; node_modules is not checked in
npm run build        # tsc — compiles, nothing more. No lint, no formatter, no test suite.
npm run dev          # tsx watch src/index.ts
npm run clean
npm run snapshot:tools # rewrite test/tools-baseline.json from the live server
npm run check:tools    # diff the advertised tool surface against it, exit 1 on drift
```

There is no test suite. `npm run build` passing plus `npm run check:tools` reporting no drift is the bar for "it works". Don't claim a change is verified beyond that.

No release/publish tooling exists (the upstream `scripts/release.sh` and the `release:*` scripts were removed). Keep it that way unless asked. `server.json` is inert MCP Registry metadata kept for reference — it is not validated or synced by anything.

## Layout

```
src/index.ts              entry; mode dispatch + stdio/local-HTTP servers
src/server/mcp.ts         createMcpServer() — the single tool registration list
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
scripts/snapshot-tools.ts tools/list baseline + drift check (no credentials needed)
test/tools-baseline.json  the frozen advertised tool surface — keep in sync, review diffs
fortnox_docs/openapi.json current Fortnox OpenAPI spec — grep it, don't read it
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
3. **Register it in `src/server/mcp.ts`** — the one registration list that every transport (stdio, local HTTP, remote) builds from. Nothing else needs touching.
4. Checks: `npm run build`, then `npm run check:tools` and review the diff against `test/tools-baseline.json`; `npm run snapshot:tools` to accept a deliberate change. Keep README's tool list true.

## API + data conventions

- All Fortnox traffic goes through `fortnoxRequest` / `fetchAllPages` in `src/services/api.ts`. Don't call axios directly from a tool.
- The rate limiter is module-global (25 req / 5 s, in-memory, per process). It does not coordinate across processes, so running several instances multiplies the effective request rate.
- Fortnox returns PascalCase objects (`Invoice`, `MetaInformation["@TotalResources"]`). Declare local `Fortnox*` interfaces per tool file (that's the existing pattern — no shared API type module) and convert to snake_case keys in `output`.
- Pagination: `limit` 1–100 (default 20), `page` from 1. Analytics/BI queries use `fetchAllPages`, which is capped by `MAX_FETCH_ALL_RESULTS` / `MAX_FETCH_ALL_PAGES` and reports `truncated` — surface that, don't drop it.
- Money: `formatMoney` → `sv-SE` with 2 decimals + `SEK`. Dates in and out are `YYYY-MM-DD`; `formatDisplayDate` only for md output.
- Responses are truncated at `CHARACTER_LIMIT` (25 000) in `buildToolResponse`.

## Gotchas

- ESM with `module: Node16`: **every relative import needs a `.js` extension** (`./services/api.js`), even in `.ts` files. CI-free repo, so a missing extension only shows up at runtime or on `tsc`.
- TypeScript 7 (the native Go `tsc`) with no declaration emit; `engines` is `>=22`. `exactOptionalPropertyTypes` is still off — enabling it produces 10 errors, 4 of them at `StreamableHTTPServerTransport` call sites that the SDK v2 migration deletes.
- zod v3 — `z.nativeEnum`, not v4 syntax. Schemas are `.strict()`, so new args must be added to the schema or calls fail.
- Look up Fortnox endpoints/fields by grepping `fortnox_docs/openapi.json` (OpenAPI: `paths`, `components.schemas`). It's ~1.7 MB / 285 paths; never load it whole.
- Fortnox has `-v2` variants of invoices, orders, offers and articles (plus assets, recurring-billing, bank-process areas this server does not cover). Every tool currently targets v1, and nothing in v1 is deprecated in the spec — so v1 is correct today and the v2 move is planned, not urgent.
- Remote mode needs `SERVER_URL`, `JWT_SECRET`, `FORTNOX_CLIENT_ID`, `FORTNOX_CLIENT_SECRET`; Redis vars fall back to in-memory storage with a warning (loses tokens on restart).
- Remote mode keeps OAuth client registrations, pending authorizations, issued codes and revocations **in memory** (`oauthProvider.ts`) — it assumes a single long-lived instance behind a reverse proxy. Clustering it would need external state; don't "just add replicas".
- The Express app is bound over plain HTTP; TLS and access control belong to the reverse proxy (Tailscale/WireGuard in the intended setup), not to this code.
- Fortnox refresh tokens are **single-use** — any code that refreshes must persist the new one (`persistTokens`) or the next run is broken. Both providers dedupe concurrent refreshes; keep that.
- Secrets: never log tokens, never commit `.env` (gitignored). User tokens live outside the repo at `~/.fortnox-mcp/tokens.json` (0600).
- `.agents/skills/mcp-builder/` holds MCP server design guidance (tool naming, error message quality, context budget). Read it when adding a new tool domain. It is gitignored — local to this machine, so it may be absent in a fresh clone.

## Planned work (agreed — don't re-litigate without the user)

A rewrite is in progress. Decisions already made, in execution order:

1. ~~Shared registry + frozen `tools/list` baseline~~ — done.
2. ~~TypeScript 7, no declaration emit, `engines >=22`~~ — done.
3. **SDK v2 migration.** `@modelcontextprotocol/sdk` → `@modelcontextprotocol/server@2.4.0` + `@modelcontextprotocol/core` + `@modelcontextprotocol/express` (`@modelcontextprotocol/codemod` may help). Covers stdio *and* remote mode; the OAuth/bearer wiring is the least-explored part. Prerequisite for dropping zod, because v2 accepts `StandardSchemaWithJSON`.
4. **Effect spine.** Effect 4 (`effect@^4`, LTS, zero deps): `effect/http` replaces axios, retry/backoff via `Schedule`, a `ManagedRuntime` built once, token provider behind a `Layer`, and the remote user id passed per request as a service (replacing `AsyncLocalStorage`). The 25 req/5 s limiter is **hand-built** — Effect 4 has no `RateLimiter` module.
5. **Domain conversion, strangler.** One domain per commit, `Effect.gen` handlers, one Effect schema per tool as the output source of truth (markdown stays hand-written), `outputSchema` declared on all 51 via a small bridge. The bridge: Effect gives Standard Schema v1 `validate` but not `~standard.jsonSchema`, so wrap `JSONSchema.make` output in a `StandardSchemaWithJSON` object (~20 lines, may need `toDocumentDraft07`).
6. **Fortnox v1 → v2 endpoints** for invoices/orders/offers/articles, after the spine settles.

Open items deliberately not in that list: trimming tool descriptions (~28k chars ≈ 7k tokens on every connect — the biggest remaining agent-facing win); adding a test suite; migrating `scripts/get-token.ts` and `evaluations/`.

Verification reality: no Fortnox credentials in this environment yet, so everything so far is checked by `npm run build` + `npm run check:tools` only. Live calls against a real account are the next thing that must happen before tool handlers are trusted.
