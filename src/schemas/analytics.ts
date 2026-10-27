import { Schema } from "effect";
import { describe } from "../services/mcpSchema.js";
import {
  DatePeriodSchema,
  DateString,
  NullableString,
  ResponseFormatSchema,
  ShortText,
  optional,
  optionalValue
} from "./shared.js";

/**
 * Input and output schemas for the analytics tools (invoice summary, top
 * customers, unpaid report).
 */

const Stats = Schema.Struct({
  count: Schema.Finite,
  total: Schema.Finite,
  average: Schema.Finite,
  min: Schema.Finite,
  max: Schema.Finite,
  paid_count: Schema.Finite,
  unpaid_count: Schema.Finite,
  total_balance: Schema.Finite
});

const Period = optional(
  DatePeriodSchema.pipe(
    describe(
      "Date period to analyze (e.g., 'this_month', 'last_quarter'). If not specified, analyzes all invoices."
    )
  )
);

const FromDate = DateString("Start date for analysis (YYYY-MM-DD). Ignored if period is specified.");
const ToDate = DateString("End date for analysis (YYYY-MM-DD). Ignored if period is specified.");

const InvoiceStatusFilter = optional(
  Schema.Literals(["cancelled", "fullypaid", "unpaid", "unpaidoverdue", "unbooked"]).pipe(
    describe("Filter invoices by status before calculating summary")
  )
);

const DetailInvoices = Schema.Array(
  Schema.Struct({
    document_number: Schema.String,
    customer_number: NullableString,
    customer_name: NullableString,
    invoice_date: NullableString,
    total: Schema.Finite,
    balance: Schema.Finite,
    status: Schema.String
  })
);

export const InvoiceSummarySchema = Schema.Struct({
  period: Period,
  from_date: FromDate,
  to_date: ToDate,
  filter: InvoiceStatusFilter,
  customer_number: ShortText(50, "Filter by specific customer number"),
  group_by: optional(
    Schema.Literals(["customer", "month", "status"]).pipe(
      describe("Group summary statistics by this dimension")
    )
  ),
  include_details: optional(
    Schema.Boolean.pipe(describe("Include list of individual invoices in the response (default false)"))
  ),
  response_format: ResponseFormatSchema
});

export type InvoiceSummaryInput = typeof InvoiceSummarySchema.Type;

export const TopCustomersSchema = Schema.Struct({
  metric: optional(
    Schema.Literals(["total_amount", "invoice_count", "unpaid_amount", "average_invoice"]).pipe(
      describe("Metric to rank customers by (default 'total_amount')")
    )
  ),
  period: Period,
  from_date: FromDate,
  to_date: ToDate,
  top_n: optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      Schema.check(Schema.isLessThanOrEqualTo(50)),
      describe("Number of top customers to return (1-50, default 10)")
    )
  ),
  include_details: optional(
    Schema.Boolean.pipe(describe("Include invoice breakdown for each customer (default false)"))
  ),
  response_format: ResponseFormatSchema
});

export type TopCustomersInput = typeof TopCustomersSchema.Type;

export const UnpaidReportSchema = Schema.Struct({
  min_amount: optional(
    Schema.Finite.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      describe("Only include invoices with balance >= this amount")
    )
  ),
  customer_number: ShortText(50, "Filter by specific customer number"),
  group_by: optional(
    Schema.Literals(["customer", "age_bucket", "both"]).pipe(
      describe("How to group unpaid invoices in the report (default 'both')")
    )
  ),
  include_details: optional(
    Schema.Boolean.pipe(describe("Include list of individual unpaid invoices (default true)"))
  ),
  response_format: ResponseFormatSchema
});

export type UnpaidReportInput = typeof UnpaidReportSchema.Type;

/* ------------------------------- outputs ------------------------------- */

export const InvoiceSummaryOutput = Schema.Struct({
  period: NullableString,
  date_range: NullableString,
  api_total: Schema.Finite,
  fetched: Schema.Finite,
  truncated: Schema.Boolean,
  truncation_reason: optionalValue(NullableString),
  summary: Stats,
  groups: optionalValue(
    Schema.Array(
      Schema.Struct({
        key: Schema.String,
        stats: Stats
      })
    )
  ),
  invoices: optionalValue(DetailInvoices)
});

export type InvoiceSummaryOutput = typeof InvoiceSummaryOutput.Type;

export const TopCustomersOutput = Schema.Struct({
  metric: Schema.String,
  period: NullableString,
  date_range: NullableString,
  total_invoices_analyzed: Schema.Finite,
  unique_customers: Schema.Finite,
  truncated: Schema.Boolean,
  truncation_reason: optionalValue(NullableString),
  customers: Schema.Array(
    Schema.Struct({
      rank: Schema.Finite,
      customer_number: NullableString,
      customer_name: NullableString,
      total_amount: Schema.Finite,
      invoice_count: Schema.Finite,
      unpaid_amount: Schema.Finite,
      average_invoice: Schema.Finite,
      invoices: optionalValue(
        Schema.Array(
          Schema.Struct({
            document_number: Schema.String,
            invoice_date: NullableString,
            total: Schema.Finite,
            balance: Schema.Finite
          })
        )
      )
    })
  )
});

export type TopCustomersOutput = typeof TopCustomersOutput.Type;

export const UnpaidReportOutput = Schema.Struct({
  summary: Schema.Struct({
    total_invoices: Schema.Finite,
    total_invoice_amount: Schema.Finite,
    total_unpaid_balance: Schema.Finite,
    unique_customers: Schema.Finite
  }),
  truncated: Schema.Boolean,
  truncation_reason: optionalValue(NullableString),
  by_age_bucket: optionalValue(
    Schema.Array(
      Schema.Struct({
        bucket: Schema.String,
        count: Schema.Finite,
        total_balance: Schema.Finite
      })
    )
  ),
  by_customer: optionalValue(
    Schema.Array(
      Schema.Struct({
        customer: Schema.String,
        count: Schema.Finite,
        total_balance: Schema.Finite
      })
    )
  ),
  invoices: optionalValue(
    Schema.Array(
      Schema.Struct({
        document_number: Schema.String,
        customer_number: NullableString,
        customer_name: NullableString,
        invoice_date: NullableString,
        due_date: NullableString,
        total: Schema.Finite,
        balance: Schema.Finite,
        age_bucket: Schema.String
      })
    )
  )
});

export type UnpaidReportOutput = typeof UnpaidReportOutput.Type;
