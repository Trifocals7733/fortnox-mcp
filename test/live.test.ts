import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../src/server/mcp.js";
import { fortnoxRequest } from "../src/services/api.js";

/**
 * Live tests: the only place in this repo that writes to Fortnox.
 *
 *   FORTNOX_TEST_COMPANY=1888108 npm run test:live
 *
 * Skipped unless FORTNOX_TEST_COMPANY is set *and* a token exists, so
 * `npm run test` and `npm run check` never touch the API. The company number is
 * the safety rail: the suite refuses to run against anything else, because
 * every test below creates, updates or deletes real records.
 */

const TEST_COMPANY = process.env.FORTNOX_TEST_COMPANY;
const hasToken =
  Boolean(process.env.FORTNOX_REFRESH_TOKEN) ||
  existsSync(join(homedir(), ".fortnox-mcp", "tokens.json"));
const gate = Boolean(TEST_COMPANY) && hasToken;

if (!gate) {
  test("live tests", { skip: "set FORTNOX_TEST_COMPANY (and a token) to run" }, () => {});
} else {
  const server = createMcpServer();
  const client = new Client({ name: "live", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({
      name,
      arguments: { ...args, response_format: "json" }
    });
    const text = String((result.content as { text?: string }[] | undefined)?.[0]?.text ?? "");
    return { isError: Boolean(result.isError), output: result.structuredContent as any, text };
  };

  const ok = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await call(name, args);
    assert.equal(result.isError, false, `${name} failed: ${result.text.slice(0, 200)}`);
    return result.output;
  };

  // Refuse to write anywhere but the designated test company.
  const company = await ok("fortnox_get_company_info");
  if (String(company.database_number) !== String(TEST_COMPANY)) {
    throw new Error(
      `Refusing to run: connected company is ${company.database_number} (${company.company_name}), ` +
        `but FORTNOX_TEST_COMPANY is ${TEST_COMPANY}. Point a test company's token at this run first ` +
        `(npm run company -- use ${TEST_COMPANY}).`
    );
  }

  test.after(async () => {
    await client.close();
    await server.close();
  });

  test("customer lifecycle: create, read, update, delete", async () => {
    const created = await ok("fortnox_create_customer", {
      name: "MCP Live Test AB",
      email: "live-test@example.com",
      city: "Göteborg",
      country_code: "SE"
    });
    assert.equal(created.success, true);
    const number = String(created.customer_number);
    assert.ok(number, "no customer number returned");

    try {
      const fetched = await ok("fortnox_get_customer", { customer_number: number });
      assert.equal(fetched.name, "MCP Live Test AB");
      assert.equal(fetched.email, "live-test@example.com");
      assert.equal(fetched.country_code, "SE");

      await ok("fortnox_update_customer", { customer_number: number, phone: "031-123456" });
      const updated = await ok("fortnox_get_customer", { customer_number: number });
      assert.equal(updated.phone, "031-123456");
    } finally {
      const deleted = await call("fortnox_delete_customer", { customer_number: number });
      assert.equal(deleted.isError, false, "cleanup failed");
    }

    const gone = await call("fortnox_get_customer", { customer_number: number });
    assert.equal(gone.isError, true, "deleted customer still readable");
  });

  test("supplier lifecycle: create, read, delete", async () => {
    const created = await ok("fortnox_create_supplier", { name: "MCP Live Supplier AB" });
    const number = String(created.supplier_number);
    try {
      const fetched = await ok("fortnox_get_supplier", { supplier_number: number });
      assert.equal(fetched.name, "MCP Live Supplier AB");
    } finally {
      await ok("fortnox_delete_supplier", { supplier_number: number });
    }
  });

  test("account create is readable back and then removed", async () => {
    // 1999 is outside the seeded chart's used range in a fresh test company.
    const number = 1999;
    const created = await ok("fortnox_create_account", {
      account_number: number,
      description: "MCP live test account"
    });
    assert.equal(created.success, true);

    const fetched = await ok("fortnox_get_account", { account_number: number });
    assert.equal(fetched.description, "MCP live test account");
    assert.equal(fetched.active, true);

    await ok("fortnox_delete_account", { account_number: number });
  });

  test("voucher create returns a balanced entry that reads back with its rows", async () => {
    const created = await ok("fortnox_create_voucher", {
      voucher_series: "A",
      description: "MCP live test voucher",
      transaction_date: "2026-03-01",
      rows: [
        { account_number: 1930, debit: 100 },
        { account_number: 3001, credit: 100 }
      ]
    });
    assert.equal(created.success, true);

    const fetched = await ok("fortnox_get_voucher", {
      voucher_series: created.voucher_series,
      voucher_number: created.voucher_number,
      financial_year: 1
    });
    const debit = fetched.rows.reduce((sum: number, row: any) => sum + row.debit, 0);
    const credit = fetched.rows.reduce((sum: number, row: any) => sum + row.credit, 0);
    assert.equal(debit, 100, "debit total changed");
    assert.equal(credit, 100, "credit total changed");
  });

  test("invoice lifecycle: draft, bookkeep, credit", async () => {
    const customer = await ok("fortnox_create_customer", { name: "MCP Live Invoice AB" });
    const customerNumber = String(customer.customer_number);

    try {
      const invoice = await ok("fortnox_create_invoice", {
        customer_number: customerNumber,
        rows: [{ description: "Live test", quantity: 2, price: 1000, vat: 25 }]
      });
      assert.equal(invoice.success, true);
      // 2 x 1000 + 25% VAT
      assert.equal(invoice.total, 2500, "invoice total is not quantity * price + VAT");

      const documentNumber = String(invoice.document_number);
      const detail = await ok("fortnox_get_invoice", { document_number: documentNumber });
      assert.equal(detail.rows.length, 1);
      assert.equal(detail.rows[0].quantity, 2);
      assert.equal(detail.booked, false);

      const booked = await ok("fortnox_bookkeep_invoice", { document_number: documentNumber });
      assert.equal(booked.booked, true);

      const credit = await ok("fortnox_credit_invoice", { document_number: documentNumber });
      assert.ok(credit.credit_document_number, "no credit document created");
      assert.equal(credit.total, 2500);
    } finally {
      await call("fortnox_delete_customer", { customer_number: customerNumber });
    }
  });

  test("supplier invoice reads survive Fortnox's stringly-typed fields", async () => {
    // No tool creates supplier invoices, so seed one through the API: on this
    // endpoint Fortnox returns Total and GivenNumber as strings and Balance as
    // a number in the detail but a string in the list, and Credit as "false".
    const supplier = await ok("fortnox_create_supplier", { name: "MCP Live SI Supplier AB" });
    const supplierNumber = String(supplier.supplier_number);
    const seeded = await fortnoxRequest<any>("/3/supplierinvoices", "POST", {
      SupplierInvoice: {
        SupplierNumber: supplierNumber,
        InvoiceDate: "2026-03-01",
        DueDate: "2026-03-31",
        InvoiceNumber: `LIVE-${Date.now()}`,
        SupplierInvoiceRows: [
          { Account: 4010, Debit: 100 },
          { Account: 2440, Credit: 100 }
        ]
      }
    });
    const givenNumber = String(seeded.SupplierInvoice.GivenNumber);
    assert.ok(givenNumber, "seeding returned no given number");

    try {
      const detail = await ok("fortnox_get_supplier_invoice", { given_number: givenNumber });
      assert.equal(typeof detail.given_number, "string");
      assert.equal(typeof detail.total, "number");
      assert.equal(typeof detail.credit, "boolean", 'Credit arrives as the string "false"');
      assert.equal(detail.credit, false);

      const list = await ok("fortnox_list_supplier_invoices", { limit: 50 });
      assert.equal(typeof list.total, "number");
      const seededItem = list.invoices.find((i: any) => i.given_number === givenNumber);
      assert.ok(seededItem, "seeded invoice missing from the list");
      assert.equal(typeof seededItem.balance, "number");

      await ok("fortnox_payables_report", { include_details: true });
    } finally {
      // A supplier cannot be deleted while it has an unpaid, uncancelled
      // supplier invoice, so clean up in that order.
      await fortnoxRequest(`/3/supplierinvoices/${givenNumber}/cancel`, "PUT").catch(() => {});
      await call("fortnox_delete_supplier", { supplier_number: supplierNumber });
    }
  });

  test("every read-only tool answers with well-formed output", async () => {
    // Folded in from scripts/smoke.ts: the same tools, but with assertions
    // instead of just an exit code.
    const cases: [string, Record<string, unknown>, (output: any) => void][] = [
      ["fortnox_get_company_info", {}, (o) => assert.ok(o.company_name)],
      ["fortnox_list_financial_years", {}, (o) => assert.equal(typeof o.count, "number")],
      ["fortnox_list_accounts", { limit: 3 }, (o) => assert.equal(typeof o.total, "number")],
      ["fortnox_list_voucher_series", {}, (o) => assert.ok(o.count >= 0)],
      ["fortnox_list_customers", { limit: 3 }, (o) => assert.equal(typeof o.total, "number")],
      ["fortnox_list_suppliers", { limit: 3 }, (o) => assert.equal(typeof o.total, "number")],
      ["fortnox_list_invoices", { limit: 3 }, (o) => assert.ok(Array.isArray(o.invoices))],
      ["fortnox_list_invoices", { fetch_all: true }, (o) => assert.equal(o.fetched_all, true)],
      ["fortnox_list_vouchers", { limit: 3 }, (o) => assert.equal(typeof o.total, "number")],
      ["fortnox_list_supplier_invoices", { limit: 3 }, (o) => assert.ok(Array.isArray(o.invoices))],
      ["fortnox_list_orders", { limit: 3 }, (o) => assert.ok(Array.isArray(o.orders))],
      ["fortnox_list_offers", { limit: 3 }, (o) => assert.ok(Array.isArray(o.offers))],
      [
        "fortnox_search_vouchers",
        { search_text: "ab", financial_year: 1 },
        (o) => assert.equal(typeof o.matching_count, "number")
      ],
      [
        "fortnox_account_activity",
        { account_number: 1930, financial_year: 1 },
        (o) => assert.ok(Array.isArray(o.transactions))
      ],
      [
        "fortnox_invoice_summary",
        { period: "this_year" },
        (o) => assert.equal(typeof o.summary.count, "number")
      ],
      [
        "fortnox_top_customers",
        { period: "this_year" },
        (o) => assert.ok(Array.isArray(o.customers))
      ],
      ["fortnox_unpaid_report", {}, (o) => assert.equal(typeof o.summary.total_invoices, "number")],
      [
        "fortnox_cash_flow_forecast",
        { horizon_days: 30 },
        (o) => assert.ok(Array.isArray(o.periods))
      ],
      [
        "fortnox_order_pipeline",
        { period: "this_year" },
        (o) => assert.equal(typeof o.summary.total_orders, "number")
      ],
      [
        "fortnox_sales_funnel",
        { period: "this_year" },
        (o) => assert.equal(typeof o.funnel.invoices.count, "number")
      ],
      [
        "fortnox_product_performance",
        { period: "this_year" },
        (o) => assert.ok(Array.isArray(o.top_performers))
      ],
      [
        "fortnox_period_comparison",
        { current_period: "this_month" },
        (o) => assert.ok(o.current_period.metrics)
      ],
      [
        "fortnox_customer_growth",
        { current_period: "this_year" },
        (o) => assert.equal(typeof o.summary.total_customers_analyzed, "number")
      ],
      [
        "fortnox_project_profitability",
        { period: "this_year" },
        (o) => assert.ok(Array.isArray(o.projects))
      ],
      [
        "fortnox_cost_center_analysis",
        { period: "this_year" },
        (o) => assert.ok(Array.isArray(o.cost_centers))
      ],
      [
        "fortnox_expense_analysis",
        { period: "this_year" },
        (o) => assert.ok(Array.isArray(o.expense_classes))
      ],
      ["fortnox_yearly_comparison", { years: 2 }, (o) => assert.ok(Array.isArray(o.years))],
      [
        "fortnox_gross_margin_trend",
        { period: "this_year" },
        (o) => assert.ok(Array.isArray(o.periods))
      ]
    ];
    for (const [name, args, check] of cases) {
      const output = await ok(name, args);
      check(output);
    }
    assert.equal(cases.length, 28, "read-only matrix shrank");
  });

  test("updates and cancels round-trip", async () => {
    const account = 1998;
    const created = await ok("fortnox_create_account", {
      account_number: account,
      description: "MCP live update account"
    });
    assert.equal(created.success, true);
    try {
      await ok("fortnox_update_account", {
        account_number: account,
        description: "renamed by test"
      });
      const after = await ok("fortnox_get_account", { account_number: account });
      assert.equal(after.description, "renamed by test");
    } finally {
      await call("fortnox_delete_account", { account_number: account });
    }

    const supplier = await ok("fortnox_create_supplier", { name: "MCP Live Update Supplier" });
    const supplierNumber = String(supplier.supplier_number);
    try {
      await ok("fortnox_update_supplier", { supplier_number: supplierNumber, phone: "031-999999" });
      const after = await ok("fortnox_get_supplier", { supplier_number: supplierNumber });
      assert.equal(after.phone, "031-999999");
    } finally {
      await call("fortnox_delete_supplier", { supplier_number: supplierNumber });
    }

    const customer = await ok("fortnox_create_customer", { name: "MCP Live Cancel AB" });
    const customerNumber = String(customer.customer_number);
    try {
      const draft = await ok("fortnox_create_invoice", {
        customer_number: customerNumber,
        rows: [{ description: "to cancel", quantity: 1, price: 100, vat: 0 }]
      });
      const documentNumber = String(draft.document_number);

      await ok("fortnox_update_invoice", {
        document_number: documentNumber,
        remarks: "edited by test"
      });
      const edited = await ok("fortnox_get_invoice", { document_number: documentNumber });
      assert.equal(edited.remarks, "edited by test");

      const cancelled = await ok("fortnox_cancel_invoice", { document_number: documentNumber });
      assert.equal(cancelled.cancelled, true);
    } finally {
      await call("fortnox_delete_customer", { customer_number: customerNumber });
    }
  });

  test("invalid arguments are rejected before reaching Fortnox", async () => {
    const bad = await call("fortnox_list_invoices", { limit: 0 });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /limit/i);

    const unbalanced = await call("fortnox_create_voucher", {
      voucher_series: "A",
      description: "unbalanced",
      transaction_date: "2026-03-01",
      rows: [{ account_number: 1930, debit: 100 }]
    });
    assert.equal(unbalanced.isError, true, "single-row voucher accepted");
  });
}
