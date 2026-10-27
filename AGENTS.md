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
npm run smoke          # live read-only calls against the real Fortnox account
```

`smoke` needs credentials and is read-only on purpose (safe against production books); it prints tool names and counts, never account data or tokens, and exits 1 on any failure.

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
src/services/runtime.ts   AppLayer + the single ManagedRuntime (rate limiter, token provider, fetch HTTP client)
src/services/rateLimiter.ts  hand-built 25 req / 5 s gate (Effect 4 has no RateLimiter module)
src/services/tokenProvider.ts  access-token lookup as an Effect service + CurrentUser
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

Every domain is now Effect Schema (`src/schemas/<domain>.ts`), with shared building blocks in `src/schemas/shared.ts`:

1. Schema in `src/schemas/<domain>.ts` as an Effect `Schema.Struct`, snake_case field names, `describe("...")` on every field, plus an **output** schema per tool. Export `type X = typeof XSchema.Type`.
2. In `src/tools/<domain>.ts`, pass `inputSchema: mcpSchema(XSchema)` and `outputSchema: mcpSchema(XOutput)`, and apply defaults in the handler (`params.limit ?? DEFAULT_PAGE_SIZE`) rather than in the schema.

### Effect Schema gotchas (learned the hard way)

- **Any pipeable annotation helper needs an explicit generic on the returned function.** `const describe = (t: string) => <S extends Schema.Top>(self: S): S["Rebuild"] => …`. Without it the generic is fixed at the outer call and every struct it touches silently widens to `{}` — handler arguments stop being typed and the compiler says nothing.
- Use `Schema.Finite`, not `Schema.Number`, for counts and money in output schemas. `Number` admits `Infinity`/`NaN` and advertises `anyOf: [number, "Infinity"|"-Infinity"|"NaN"]`.
- Optional-with-default combinators (`withDecodingDefault*`) render the field as `anyOf: [type, null]` and take an `Effect`, so defaults live in handlers instead.
- Effect structs emit `additionalProperties: true`; zod's `.strict()` emitted `false`. That is a deliberate, documented relaxation: unknown arguments are ignored instead of rejected.
- `npm run check:tools` is what catches mistakes here — the schema diff must show only the intended shape change, no lost properties and no lost descriptions.
2. Handler in `src/tools/<domain>.ts` via `server.registerTool(name, { title, description, inputSchema, annotations }, handler)`.
   - Name: `fortnox_<verb>_<noun>`.
   - Description is a literal for the LLM, not JSDoc: `Args:` / `Returns:` / `Examples:` sections. Keep it tight — descriptions are optimized for connect time.
   - `annotations` is required on every tool; get `readOnlyHint` / `destructiveHint` right (deletes and bookkeeping are destructive).
   - Body: map snake_case args → Fortnox's PascalCase query params (`customer_number` → `customernumber`, `search_name` → `name`), `fortnoxRequest<T>(endpoint, method, data, params)`, build a snake_case `output` object, branch on `response_format` (JSON = `JSON.stringify(output, null, 2)`, otherwise a formatter helper), then `return buildToolResponse(text, output)` — never a bare `{ content }`.
   - Wrap the whole body in `try/catch` returning `buildErrorResponse(error)`.
3. **Register it in `src/server/mcp.ts`** — the one registration list that every transport (stdio, local HTTP, remote) builds from. Nothing else needs touching.
4. Checks: `npm run build`, then `npm run check:tools` and review the diff against `test/tools-baseline.json`; `npm run snapshot:tools` to accept a deliberate change. Keep README's tool list true.

## API + data conventions

- All Fortnox traffic goes through `fortnoxRequest` / `fetchAllPages` in `src/services/api.ts`. Don't call `effect/http` directly from a tool.
- `fortnoxRequest` keeps its plain `async` signature and runs an Effect internally through the process-wide runtime (`getRuntime()`). That is deliberate: the 51 handlers stay untouched until the domain conversion, so the transport swap is one file.
- Effect services live in `src/services/runtime.ts`: `RateLimiter` (sliding window, one per process), `TokenProviderService`, `CurrentUser`, plus `FetchHttpClient.layer`. Retry/backoff (429/5xx/timeouts, 3 attempts, exponential) and the 30s timeout are inside `fortnoxRequest`.
- **Form bodies need `HttpClientRequest.bodyUrlParams(form)`.** `bodyText()` does not attach a body to the request in a pipe: it typechecks, the call succeeds, and Fortnox answers "invalid_request: The grant type was not specified". This bit the OAuth token refresh and no check short of a live call catches it.
- **The user id is still read from `AsyncLocalStorage` once per call**, then provided to the Effect as the `CurrentUser` service. True removal needs the handlers to receive it, which is the domain conversion's job — do not claim ALS is gone until `runWithContext` is.
- The rate limiter is one per process, so running several instances multiplies the effective request rate.
- Fortnox returns PascalCase objects (`Invoice`, `MetaInformation["@TotalResources"]`). Declare local `Fortnox*` interfaces per tool file (that's the existing pattern — no shared API type module) and convert to snake_case keys in `output`.
- Pagination: `limit` 1–100 (default 20), `page` from 1. Analytics/BI queries use `fetchAllPages`, which is capped by `MAX_FETCH_ALL_RESULTS` / `MAX_FETCH_ALL_PAGES` and reports `truncated` — surface that, don't drop it.
- Money: `formatMoney` → `sv-SE` with 2 decimals + `SEK`. Dates in and out are `YYYY-MM-DD`; `formatDisplayDate` only for md output.
- Responses are truncated at `CHARACTER_LIMIT` (25 000) in `buildToolResponse`.

## Gotchas

- ESM with `module: Node16`: **every relative import needs a `.js` extension** (`./services/api.js`), even in `.ts` files. CI-free repo, so a missing extension only shows up at runtime or on `tsc`.
- **SDK v2 package split.** `@modelcontextprotocol/server` (server + `McpServer`), `/server/stdio` (stdio transport), `@modelcontextprotocol/node` (`NodeStreamableHTTPServerTransport`), `@modelcontextprotocol/client` (client + `InMemoryTransport`, used by the snapshot script), `@modelcontextprotocol/server-legacy/auth` (the OAuth **authorization server** router this repo needs). The v1 `@modelcontextprotocol/sdk` package is gone.
- **`InMemoryTransport` halves must come from the same package.** The server and client packages bundle separate copies with private state, so a linked pair has to be created from one import — the snapshot script takes both from `@modelcontextprotocol/client`.
- **Remote mode is an authorization server, and v2 calls that path deprecated.** `mcpAuthRouter` + `OAuthServerProvider` only exist in `@modelcontextprotocol/server-legacy/auth`, a frozen v1 copy; the SDK's guidance is to move an AS to a dedicated IdP or OAuth library eventually. Resource-server helpers (`requireBearerAuth`, `mcpAuthMetadataRouter`) do have a maintained home in `@modelcontextprotocol/express`, so re-pointing those is a small follow-up, but the verifier must then throw the v2 `OAuthError` — the express middleware does not recognise the legacy error classes.
- **zod must be ≥4.2** for the SDK to read `~standard.jsonSchema`. The repo is on zod 4 (`z.nativeEnum`, `.strict()` and `.email()` are deprecated but still work — `tsc` is clean on them). v1's zod-3 support is gone entirely.
- TypeScript 7 (the native Go `tsc`) with no declaration emit; `engines` is `>=22`. `exactOptionalPropertyTypes` is still off — enabling it now produces 6 errors, all in our own code (`config.ts` ×2, `api.ts`, `vouchers.ts`, `biAnalytics.ts`, `oauthProvider.ts`) and none at SDK call sites any more. Worth doing, but it is its own commit.
- **Config comes from `.env`**, loaded by Node's `--env-file-if-exists=.env` in the `start` / `dev` / `get-token` scripts. There is no `dotenv` dependency and none is needed (Node 22+). `.env` is gitignored; `.env.example` is committed.
- **Fortnox permission failures are two different errors**, and neither is a startup error:
  - `400 ... Har inte behörighet för scope` — the token lacks that scope. Add it to `FORTNOX_SCOPES` in `src/auth/credentials.ts` *and* to `scripts/get-token.ts`, then re-authorize.
  - `400 ... Det finns ingen aktiv licens för önskat scope` — the subscription does not have that Fortnox module at all (the test company has no Order module, so `fortnox_list_orders` and `fortnox_list_offers` always fail there). Not a bug; verify those two some other way.
- zod **4** (4.6.7). The SDK reads `~standard.jsonSchema`, which needs ≥4.2. `z.nativeEnum`, `.strict()` and `.email()` are deprecated in v4 but functional — `tsc` is clean on them, so leave them alone until the Effect Schema conversion replaces zod outright. Schemas are `.strict()`, so new args must be added to the schema or calls fail. Note `.refine()` survives serialization now: a tool whose schema carries one advertises its real arguments (v1 advertised `{}`), and violations surface as `Input validation error: …`.
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
3. ~~**SDK v2 migration.**~~ — done. `@modelcontextprotocol/server` 2.4.0 + `core`-free `node`/`client` + `server-legacy/auth` for the OAuth AS router; zod 4 is now required. Verified: build, `check:tools`, local HTTP (`initialize` + `tools/list` + a live tool call), remote mode boot (OAuth metadata + 401 on unauthenticated `/mcp`), and live tool calls over an in-memory client.
4. ~~**Effect spine.**~~ — done. `effect@4.0.6`; `effect/http` replaced axios, retry/backoff via `Schedule`, one `ManagedRuntime` in `src/services/runtime.ts`, token provider behind a `Layer`, hand-built 25 req/5 s limiter (verified: 20 acquires in 0 ms, 30 in ~5.1 s). The user id is provided to the Effect as a `CurrentUser` service but is still read from `AsyncLocalStorage` at the call boundary; removing ALS is part of the domain conversion.
5. ~~**Domain conversion, strangler.**~~ — done, all 51 tools. Every tool declares `inputSchema` and `outputSchema` through `mcpSchema()`; **zod is gone** from the dependency list. Handlers are still plain `async` (not `Effect.gen`) — converting them was deliberately dropped: the value was in the schemas and the transport, not in rewriting 51 function bodies. The bridge: Effect gives Standard Schema v1 `validate` but not `~standard.jsonSchema`, so wrap `JSONSchema.make` output in a `StandardSchemaWithJSON` object (~20 lines, may need `toDocumentDraft07`).
6. ~~**Fortnox v1 → v2 endpoints**~~ — done for invoices, orders and offers; paths are in `FORTNOX_PATHS` (`src/constants.ts`). v2 was verified payload-compatible with v1 before switching (same envelope, same keys, plus a `Bundle` flag on invoice rows). Articles are not used: no article tool exists.

Open items deliberately not in that list: trimming tool descriptions (~28k chars ≈ 7k tokens on every connect — the biggest remaining agent-facing win); adding a test suite; migrating `scripts/get-token.ts` and `evaluations/`.

Verification reality: two Fortnox companies are connected and switchable with `npm run company` — a live one (1865351, no Order module) and a test one (1888108, with Order module and a financial year). On the test company, reads and writes have both been exercised through the tools over an in-memory MCP client: customer/supplier create-get-update-delete, account create, voucher create, invoice create-get-update-bookkeep-cancel-credit, and all 11 BI tools. Not verified anywhere: `send_invoice_email` and `approve_supplier_invoice` (real-world side effects), and the element shapes inside the aggregation arrays that are declared as `Schema.Array(Schema.Unknown)` — those need richer data than an almost-empty test company has.
