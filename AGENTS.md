# AGENTS.md

Guidance for agents working in this repo. Human-facing docs (install, OAuth setup, env var tables, tool catalogue) live in [README.md](./README.md) — read that first, don't duplicate it here.

## What this is

An MCP server exposing the Fortnox (Swedish accounting) REST API as 51 `fortnox_*` tools. TypeScript, ESM, Node 22+. Personal fork of `jakobwennberg/fortnox-mcp`; **not published anywhere** — no npm, no MCP Registry. Runs locally from `dist/index.js`, or self-hosted internally (planned: own VPS behind Tailscale). Three shapes from one tool registry:

| Shape | Entry | Auth |
|---|---|---|
| stdio (default) | `src/index.ts` → `runStdio()` | `FORTNOX_REFRESH_TOKEN` env var, persisted to `~/.fortnox-mcp/tokens.json` |
| HTTP | `src/index.ts` → `runHTTP()` | same token; no authentication of its own — the network is the access control |

Selected by `TRANSPORT` in `src/config.ts`. **There is no multi-user/OAuth mode:** it was deleted deliberately (see Planned work), so one process serves one Fortnox company.

## Commands

```bash
npm install          # required first; node_modules is not checked in
npm run check        # build + lint + tool-surface drift: the gate to run before committing
npm run build        # tsc — compiles, nothing more
npm run lint         # biome check (format + lint; no type-aware rules, see below)
npm run dev          # tsx watch src/index.ts
npm run clean
npm run snapshot:tools # rewrite test/tools-baseline.json from the live server
npm run check:tools    # diff the advertised tool surface against it, exit 1 on drift
```

`npm run check` = build + lint + tests + no tool-surface drift: the bar for "it works". Say so rather than claiming more.

The suite (`test/mcp.test.ts`, `node:test` via tsx, no new dependencies) asserts what can be asserted without credentials: tools/list matches the frozen baseline, every tool has title/description/input+output schema/annotations, no tool advertises an empty argument object, the Effect→MCP bridge validates and advertises, list outputs accept both paged and fetch_all shapes, the rate limiter throttles at 25/window, and the requested OAuth scopes cover every API area the tools call. `npm run test:live` covers the API (test/live.test.ts): all 51 tools, read-only ones as a matrix and the rest as lifecycles. It needs `FORTNOX_TEST_COMPANY` set and a token, refuses to run when the connected company does not match, and otherwise exercises customer/supplier/account/voucher/invoice lifecycles including bookkeep and credit, asserting semantics the schemas cannot (invoice total is quantity×price+VAT, a booked invoice reports booked, credit links back).

**Linting is Biome, not ESLint.** typescript-eslint requires `typescript <6.1` and this repo is on TypeScript 7, whose package has no programmatic compiler API — so type-aware rules are unavailable without downgrading the compiler. Biome parses TypeScript itself and covers format + lint in one dependency, but its rules are syntax-only: no `no-floating-promises`, no `no-unnecessary-condition`.

No release/publish tooling exists (the upstream `scripts/release.sh` and the `release:*` scripts were removed). Keep it that way unless asked. Nothing is published: there is no npm package and no MCP Registry entry, and the metadata file that implied otherwise has been deleted.

## Layout

```
src/index.ts              entry; mode dispatch + stdio/local-HTTP servers
src/server/mcp.ts         createMcpServer() — the single tool registration list
src/config.ts             TRANSPORT / PORT
src/constants.ts          base URLs, rate limits, page sizes, 25k char response cap
src/tools/<domain>.ts     tool registration — one file per domain, self-contained
src/schemas/<domain>.ts   zod input schemas (snake_case) + inferred input types
src/services/api.ts       fortnoxRequest(), rate limiter, fetchAllPages(), error mapping
src/services/runtime.ts   AppLayer + the single ManagedRuntime (rate limiter, token provider, fetch HTTP client)
src/services/rateLimiter.ts  hand-built 25 req / 5 s gate (Effect 4 has no RateLimiter module)
src/services/tokenProvider.ts  access-token lookup as an Effect service
src/services/formatters.ts buildToolResponse(), buildErrorResponse(), md money/list/detail helpers
src/services/dateHelpers.ts      period → date range, aging buckets
src/services/aggregationHelpers.ts  stats, growth, groupBy helpers for BI tools
src/auth/                 EnvVarTokenProvider (Fortnox token refresh), file token store, scopes
scripts/get-token.ts      interactive helper to obtain a local-mode refresh token
scripts/snapshot-tools.ts tools/list baseline + drift check (no credentials needed)
test/tools-baseline.json  the frozen advertised tool surface — keep in sync, review diffs
fortnox_docs/openapi.json current Fortnox OpenAPI spec — grep it, don't read it
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
3. **Register it in `src/server/mcp.ts`** — the one registration list that both transports (stdio, HTTP) build from. Nothing else needs touching.
4. Checks: `npm run build`, then `npm run check:tools` and review the diff against `test/tools-baseline.json`; `npm run snapshot:tools` to accept a deliberate change. Keep README's tool list true.

## API + data conventions

- All Fortnox traffic goes through `fortnoxRequest` / `fetchAllPages` in `src/services/api.ts`. Don't call `effect/http` directly from a tool.
- `fortnoxRequest` keeps its plain `async` signature and runs an Effect internally through the process-wide runtime (`getRuntime()`). That is deliberate: the 51 handlers stay untouched until the domain conversion, so the transport swap is one file.
- Effect services live in `src/services/runtime.ts`: `RateLimiter` (sliding window, one per process), `TokenProviderService`, plus `FetchHttpClient.layer`. Retry/backoff (429/5xx/timeouts, 3 attempts, exponential) and the 30s timeout are inside `fortnoxRequest`.
- **Form bodies need `HttpClientRequest.bodyUrlParams(form)`.** `bodyText()` does not attach a body to the request in a pipe: it typechecks, the call succeeds, and Fortnox answers "invalid_request: The grant type was not specified". This bit the OAuth token refresh and no check short of a live call catches it.
- The rate limiter is one per process, so running several instances multiplies the effective request rate.
- Fortnox returns PascalCase objects (`Invoice`, `MetaInformation["@TotalResources"]`). Declare local `Fortnox*` interfaces per tool file (that's the existing pattern — no shared API type module) and convert to snake_case keys in `output`.
- Pagination: `limit` 1–100 (default 20), `page` from 1. Analytics/BI queries use `fetchAllPages`, which is capped by `MAX_FETCH_ALL_RESULTS` / `MAX_FETCH_ALL_PAGES` and reports `truncated` — surface that, don't drop it.
- Money: `formatMoney` → `sv-SE` with 2 decimals + `SEK`. Dates in and out are `YYYY-MM-DD`; `formatDisplayDate` only for md output.
- Responses are truncated at `CHARACTER_LIMIT` (25 000) in `buildToolResponse`.

## Gotchas

- ESM with `module: Node16`: **every relative import needs a `.js` extension** (`./services/api.js`), even in `.ts` files. CI-free repo, so a missing extension only shows up at runtime or on `tsc`.
- **SDK v2 package split.** `@modelcontextprotocol/server` (server + `McpServer`), `/server/stdio` (stdio transport), `@modelcontextprotocol/node` (`NodeStreamableHTTPServerTransport`), `@modelcontextprotocol/client` (client + `InMemoryTransport`, used by the tests and the snapshot script). The v1 `@modelcontextprotocol/sdk` package is gone.
- **`InMemoryTransport` halves must come from the same package.** The server and client packages bundle separate copies with private state, so a linked pair has to be created from one import — the snapshot script takes both from `@modelcontextprotocol/client`.
- **zod must be ≥4.2** for the SDK to read `~standard.jsonSchema`. The repo is on zod 4 (`z.nativeEnum`, `.strict()` and `.email()` are deprecated but still work — `tsc` is clean on them). v1's zod-3 support is gone entirely.
- TypeScript 7 (the native Go `tsc`) with no declaration emit; `engines` is `>=22`; `exactOptionalPropertyTypes` is on.
- **Config comes from `.env`**, loaded by Node's `--env-file-if-exists=.env` in the `start` / `dev` / `get-token` scripts. There is no `dotenv` dependency and none is needed (Node 22+). `.env` is gitignored; `.env.example` is committed.
- **Fortnox types are inconsistent per field and per endpoint.** On supplier invoices `Total` is a string, `Balance` is a number in the detail endpoint but a string in the list endpoint, and `Credit` is the string `"false"`; `DeliveredQuantity` on invoice rows is a string while `Price`, `VAT` and `Total` are numbers; `DatabaseNumber` is a number despite the spec saying string. Coerce with `asNumber` / `asBool` from `services/api.ts` and verify against real data — schema validation catches it only once a company has records.
- **Fortnox permission failures are two different errors**, and neither is a startup error:
  - `400 ... Har inte behörighet för scope` — the token lacks that scope. Add it to `FORTNOX_SCOPES` in `src/auth/credentials.ts` *and* to `scripts/get-token.ts`, then re-authorize.
  - `400 ... Det finns ingen aktiv licens för önskat scope` — the subscription does not have that Fortnox module at all (the test company has no Order module, so `fortnox_list_orders` and `fortnox_list_offers` always fail there). Not a bug; verify those two some other way.
- zod **4** (4.6.7). The SDK reads `~standard.jsonSchema`, which needs ≥4.2. `z.nativeEnum`, `.strict()` and `.email()` are deprecated in v4 but functional — `tsc` is clean on them, so leave them alone until the Effect Schema conversion replaces zod outright. Schemas are `.strict()`, so new args must be added to the schema or calls fail. Note `.refine()` survives serialization now: a tool whose schema carries one advertises its real arguments (v1 advertised `{}`), and violations surface as `Input validation error: …`.
- Look up Fortnox endpoints/fields by grepping `fortnox_docs/openapi.json` (OpenAPI: `paths`, `components.schemas`). It's ~1.7 MB / 285 paths; never load it whole.
- Fortnox has `-v2` variants of invoices, orders, offers and articles (plus assets, recurring-billing, bank-process areas this server does not cover). Every tool currently targets v1, and nothing in v1 is deprecated in the spec — so v1 is correct today and the v2 move is planned, not urgent.
- The HTTP transport binds plain HTTP with **no authentication**: TLS and access control belong to the network it sits on (Tailscale/WireGuard), not to this code. Do not expose it publicly.
- One process serves one company and holds the rate limiter in-process; don't run several instances against the same Fortnox app and expect the 25 req/5 s budget to be shared.
- Fortnox refresh tokens are **single-use** — any code that refreshes must persist the new one (`persistTokens`) or the next run is broken. Both providers dedupe concurrent refreshes; keep that.
- Secrets: never log tokens, never commit `.env` (gitignored). User tokens live outside the repo at `~/.fortnox-mcp/tokens.json` (0600).
- `.agents/skills/mcp-builder/` holds MCP server design guidance (tool naming, error message quality, context budget). Read it when adding a new tool domain. It is gitignored — local to this machine, so it may be absent in a fresh clone.

## Planned work (agreed — don't re-litigate without the user)

A rewrite is in progress. Decisions already made, in execution order:

1. ~~Shared registry + frozen `tools/list` baseline~~ — done.
2. ~~TypeScript 7, no declaration emit, `engines >=22`~~ — done.
3. ~~**SDK v2 migration.**~~ — done. `@modelcontextprotocol/server` 2.4.0 + `node` + `client`; zod 4 was required at the time and has since been removed entirely.
4. ~~**Effect spine.**~~ — done. `effect@4.0.6`; `effect/http` replaced axios, retry/backoff via `Schedule`, one `ManagedRuntime` in `src/services/runtime.ts`, token provider behind a `Layer`, hand-built 25 req/5 s limiter (verified: 20 acquires in 0 ms, 30 in ~5.1 s).
5. ~~**Domain conversion, strangler.**~~ — done, all 51 tools. Every tool declares `inputSchema` and `outputSchema` through `mcpSchema()`; **zod is gone** from the dependency list. Handlers are still plain `async` (not `Effect.gen`) — converting them was deliberately dropped: the value was in the schemas and the transport, not in rewriting 51 function bodies. The bridge: Effect gives Standard Schema v1 `validate` but not `~standard.jsonSchema`, so wrap `JSONSchema.make` output in a `StandardSchemaWithJSON` object (~20 lines, may need `toDocumentDraft07`).

6. ~~**Fortnox v1 → v2 endpoints**~~ — done for invoices, orders and offers; paths are in `FORTNOX_PATHS` (`src/constants.ts`). v2 was verified payload-compatible with v1 before switching (same envelope, same keys, plus a `Bundle` flag on invoice rows). Articles are not used: no article tool exists.

7. ~~**Delete remote mode.**~~ — done. The multi-user OAuth proxy (authorization server, JWT minting, per-user token storage in Redis, `AsyncLocalStorage` request context) is gone, along with `jose`, `@upstash/redis` and `@modelcontextprotocol/server-legacy`. One process serves one Fortnox company; reachability comes from the network (Tailscale) rather than from OAuth. Restoring it would be a revert, not a rebuild — which is why it was safe to remove.

Nothing outstanding from the rewrite plan. Two tools remain unverified, and both are blocked by settings on the test company rather than by code:

- **`fortnox_approve_supplier_invoice`** answers `Inställningen för betalattestering är avstängd` — payment approval is switched off on the company. `/3/settings/company` would show it but needs a `settings` scope this server does not request, so it has to be enabled in the Fortnox UI.
- **`fortnox_send_invoice_email`** answers `Bankuppgifter saknas` — the company has no bank details on its transaction accounts (Fortnox UI: Register → Transaktionskonton). It fails before sending, so nothing was delivered anywhere.

Everything else is exercised by `npm run test:live`. The aggregation arrays declared `Schema.Array(Schema.Unknown)` are still unmodelled, and no agent has used the 51 tools for real work.

**Connect cost, measured** (`tools/list` as the client receives it): 100 352 chars ≈ 25.1k tokens for 51 tools — down from 127k at the start of the rewrite. Split: `inputSchema` ~42.5k, `outputSchema` ~40k, descriptions 6 338 (they were 27 598).

That is close to the floor for anything short of removing declared schemas: the remainder is irreducible JSON Schema structure for 102 schemas, plus ~9.8k chars of `anyOf` noise from nullable fields. The user has explicitly chosen to **keep `outputSchema` on all 51** (13.9k chars would have gone by dropping it for the 14 analytics/BI tools), so don't re-open that without them. If cost matters again, the levers are: make nullable output fields optional instead of null, or shorten field descriptions further — not dropping schemas.

Verification reality: two Fortnox companies are connected and switchable with `npm run company` — a live one (1865351, no Order module) and a test one (1888108, with Order module and a financial year). On the test company, reads and writes have both been exercised through the tools over an in-memory MCP client: customer/supplier create-get-update-delete, account create, voucher create, invoice create-get-update-bookkeep-cancel-credit, and all 11 BI tools. Not verified anywhere: `send_invoice_email` and `approve_supplier_invoice` (real-world side effects), and the element shapes inside the aggregation arrays that are declared as `Schema.Array(Schema.Unknown)` — those need richer data than an almost-empty test company has.

