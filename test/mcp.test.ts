import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Effect } from "effect";
import { FORTNOX_SCOPES } from "../src/auth/credentials.js";
import { ListInvoicesOutput, ListInvoicesSchema } from "../src/schemas/invoices.js";
import { ListOrdersOutput } from "../src/schemas/orders.js";
import { createMcpServer } from "../src/server/mcp.js";
import { mcpSchema } from "../src/services/mcpSchema.js";
import { RateLimiter, rateLimiterLayer } from "../src/services/rateLimiter.js";

const baseline = JSON.parse(readFileSync("test/tools-baseline.json", "utf8")) as {
  name: string;
}[];

async function listTools() {
  const server = createMcpServer();
  const client = new Client({ name: "test", version: "0.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    const { tools } = await client.listTools();
    return tools;
  } finally {
    await client.close();
    await server.close();
  }
}

test("tools/list matches the frozen baseline", async () => {
  const tools = await listTools();
  assert.equal(tools.length, baseline.length, "tool count changed");
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    baseline.map((t) => t.name).sort(),
    "tool names changed"
  );
});

test("every tool is fully described and annotated", async () => {
  const tools = await listTools();
  for (const tool of tools) {
    assert.ok(tool.title, `${tool.name}: missing title`);
    assert.ok((tool.description ?? "").length > 20, `${tool.name}: description too short`);
    assert.ok(tool.inputSchema, `${tool.name}: missing inputSchema`);
    assert.ok(tool.outputSchema, `${tool.name}: missing outputSchema`);
    assert.ok(tool.annotations, `${tool.name}: missing annotations`);
    assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", `${tool.name}: readOnlyHint`);
  }
});

test("input schemas advertise their arguments, not an empty object", async () => {
  const tools = await listTools();
  for (const tool of tools) {
    const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties;
    assert.ok(
      properties && Object.keys(properties).length > 0,
      `${tool.name}: no advertised properties`
    );
  }
});

test("the Effect-to-MCP bridge validates and advertises", () => {
  const bridge = mcpSchema(ListInvoicesSchema) as any;
  const jsonSchema = bridge["~standard"].jsonSchema.input({ target: "draft-2020-12" });
  assert.ok(jsonSchema.properties.customer_number, "customer_number not advertised");

  const ok = bridge["~standard"].validate({ limit: 5 });
  assert.ok(!("issues" in ok), "valid input rejected");

  const bad = bridge["~standard"].validate({ limit: 0 });
  assert.ok("issues" in bad, "limit 0 accepted");
});

test("list outputs accept both paged and fetch_all shapes", () => {
  const cases = [
    { schema: ListInvoicesOutput, key: "invoices" },
    { schema: ListOrdersOutput, key: "orders" }
  ] as const;
  for (const { schema, key } of cases) {
    const paged = {
      total: 3,
      count: 2,
      page: 1,
      limit: 2,
      has_more: true,
      total_pages: 2,
      next_offset: 2,
      [key]: []
    };
    const fetchedAll = {
      total: 3,
      count: 3,
      fetched_all: true,
      pages_fetched: 1,
      truncated: false,
      [key]: []
    };
    const validate = mcpSchema(schema) as any;
    assert.ok(!("issues" in validate["~standard"].validate(paged)), `${key}: paged rejected`);
    assert.ok(
      !("issues" in validate["~standard"].validate(fetchedAll)),
      `${key}: fetch_all rejected`
    );
  }
});

test("the rate limiter throttles at 25 per window", async () => {
  const program = Effect.gen(function* () {
    const limiter = yield* RateLimiter;
    const burst = (n: number) =>
      Effect.gen(function* () {
        for (let i = 0; i < n; i++) yield* limiter.acquire;
      });
    const timed = <E>(effect: Effect.Effect<void, E>) =>
      Effect.gen(function* () {
        const started = Date.now();
        yield* effect;
        return Date.now() - started;
      });
    const under = yield* timed(burst(20));
    const over = yield* timed(burst(30));
    return { under, over };
  });

  const { under, over } = await Effect.runPromise(Effect.provide(program, rateLimiterLayer()));
  assert.ok(under < 1000, `under-limit burst was throttled (${under}ms)`);
  assert.ok(over >= 4500, `over-limit burst was not throttled (${over}ms)`);
});

test("the requested OAuth scopes cover every API area the tools call", () => {
  for (const scope of [
    "companyinformation",
    "customer",
    "invoice",
    "supplier",
    "supplierinvoice",
    "order",
    "offer",
    "bookkeeping",
    "project",
    "costcenter"
  ]) {
    assert.ok(FORTNOX_SCOPES.includes(scope), `missing scope: ${scope}`);
  }
});
