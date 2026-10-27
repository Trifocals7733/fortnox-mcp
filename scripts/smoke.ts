#!/usr/bin/env npx tsx
/**
 * Live smoke check: drives read-only tools against the real Fortnox account
 * through an in-memory MCP client.
 *
 *   npm run smoke
 *
 * Read-only on purpose — it must be safe to run against production books.
 * Output is deliberately uninformative: names, ok/ERROR and a couple of counts,
 * never customer data or token values. Exits 1 if any call fails, so it works
 * as a gate after a refactor.
 */

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../src/server/mcp.js";

const CALLS: { name: string; args: Record<string, unknown> }[] = [
  { name: "fortnox_get_company_info", args: {} },
  { name: "fortnox_list_financial_years", args: {} },
  { name: "fortnox_list_accounts", args: { limit: 3 } },
  { name: "fortnox_list_voucher_series", args: {} },
  { name: "fortnox_list_customers", args: { limit: 3 } },
  { name: "fortnox_list_suppliers", args: { limit: 3 } },
  { name: "fortnox_list_invoices", args: { limit: 3 } },
  { name: "fortnox_list_vouchers", args: { limit: 3 } },
  { name: "fortnox_list_supplier_invoices", args: { limit: 3 } },
  { name: "fortnox_invoice_summary", args: { period: "this_year" } },
  { name: "fortnox_project_profitability", args: { period: "this_year" } },
  { name: "fortnox_cost_center_analysis", args: { from_date: "2026-01-01", to_date: "2026-12-31" } }
];

async function main(): Promise<void> {
  const server = createMcpServer();
  const client = new Client({ name: "smoke", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  let failures = 0;
  try {
    for (const call of CALLS) {
      try {
        const result = await client.callTool({
          name: call.name,
          arguments: { ...call.args, response_format: "json" }
        });
        const output = result.structuredContent as Record<string, unknown> | undefined;
        if (result.isError) {
          failures++;
          const text = String((result.content as any)?.[0]?.text ?? "").replace(/\s+/g, " ");
          console.log(`${call.name.padEnd(32)} ERROR  ${text.slice(0, 160)}`);
          continue;
        }
        const count = output?.total ?? output?.count ?? null;
        console.log(`${call.name.padEnd(32)} ok     ${count === null ? "" : `n=${count}`}`);
      } catch (error) {
        failures++;
        console.log(
          `${call.name.padEnd(32)} THREW  ${error instanceof Error ? error.message : error}`
        );
      }
    }
  } finally {
    await client.close();
    await server.close();
  }

  console.log(
    failures === 0
      ? `\nAll ${CALLS.length} calls ok.`
      : `\n${failures} of ${CALLS.length} calls failed.`
  );
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
