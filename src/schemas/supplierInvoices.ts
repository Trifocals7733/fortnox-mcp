import { Schema } from "effect";
import { describe } from "../services/mcpSchema.js";
import {
  DatePeriodSchema,
  DateString,
  ListPaginationInput,
  MutationResult,
  NullableString,
  optional,
  optionalValue,
  PaginationFields,
  ResponseFormatSchema,
  ShortText
} from "./shared.js";

/**
 * Input and output schemas for the supplier-invoice tools.
 */

const Amount = Schema.Finite.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  describe("Amount in SEK")
);

export const ListSupplierInvoicesSchema = Schema.Struct({
  ...ListPaginationInput,
  filter: optional(
    Schema.Literals([
      "cancelled",
      "fullypaid",
      "unpaid",
      "unpaidoverdue",
      "unbooked",
      "pendingpayment"
    ]).pipe(describe("Filter supplier invoices by status"))
  ),
  supplier_number: ShortText(50, "Filter by supplier number"),
  from_date: DateString("Filter invoices from this date (YYYY-MM-DD)"),
  to_date: DateString("Filter invoices to this date (YYYY-MM-DD)"),
  period: optional(DatePeriodSchema.pipe(describe("Named period; overrides from_date/to_date."))),
  from_final_pay_date: DateString("Filter by due date from (YYYY-MM-DD)"),
  to_final_pay_date: DateString("Filter by due date to (YYYY-MM-DD)"),
  sortby: optional(
    Schema.Literals([
      "suppliername",
      "suppliernumber",
      "invoicenumber",
      "invoicedate",
      "total"
    ]).pipe(describe("Field to sort results by"))
  ),
  sortorder: optional(
    Schema.Literals(["ascending", "descending"]).pipe(describe("default 'ascending'"))
  ),
  fetch_all: optional(Schema.Boolean.pipe(describe("Auto-paginate up to 10,000 results."))),
  min_amount: optional(
    Amount.pipe(describe("Filter invoices with total >= this amount (client-side filter)"))
  ),
  max_amount: optional(
    Amount.pipe(describe("Filter invoices with total <= this amount (client-side filter)"))
  ),
  response_format: ResponseFormatSchema
});

export type ListSupplierInvoicesInput = typeof ListSupplierInvoicesSchema.Type;

export const GetSupplierInvoiceSchema = Schema.Struct({
  given_number: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    describe("The supplier invoice given number to retrieve")
  ),
  response_format: ResponseFormatSchema
});

export type GetSupplierInvoiceInput = typeof GetSupplierInvoiceSchema.Type;

export const ApproveSupplierInvoiceSchema = Schema.Struct({
  given_number: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    describe("The supplier invoice given number to approve")
  ),
  response_format: ResponseFormatSchema
});

export type ApproveSupplierInvoiceInput = typeof ApproveSupplierInvoiceSchema.Type;

export const PayablesReportSchema = Schema.Struct({
  min_amount: optional(Amount.pipe(describe("Only include invoices with balance >= this amount"))),
  supplier_number: ShortText(50, "Filter by specific supplier number"),
  group_by: optional(
    Schema.Literals(["supplier", "age_bucket", "both"]).pipe(
      describe("How to group unpaid supplier invoices in the report (default 'both')")
    )
  ),
  include_details: optional(
    Schema.Boolean.pipe(describe("Include list of individual unpaid invoices (default true)"))
  ),
  response_format: ResponseFormatSchema
});

export type PayablesReportInput = typeof PayablesReportSchema.Type;

/* ------------------------------- outputs ------------------------------- */

// Fortnox returns GivenNumber and Total as strings on supplier invoices
// (unlike invoices, where the numbers really are numbers), so the handlers
// coerce the amounts and the identifier stays a string.
const SupplierInvoiceListItemSchema = Schema.Struct({
  given_number: Schema.String.pipe(describe("Fortnox given number (a string identifier)")),
  supplier_number: NullableString,
  supplier_name: NullableString,
  invoice_number: NullableString,
  invoice_date: NullableString,
  due_date: NullableString,
  total: Schema.Finite,
  balance: Schema.Finite,
  currency: Schema.String,
  booked: Schema.Boolean,
  cancelled: Schema.Boolean,
  status: Schema.String
});

export const ListSupplierInvoicesOutput = Schema.Struct({
  ...PaginationFields,
  period_description: optionalValue(Schema.String),
  next_offset: optionalValue(Schema.Finite),
  invoices: Schema.Array(SupplierInvoiceListItemSchema)
});

const SupplierInvoiceRowSchema = Schema.Struct({
  article_number: NullableString,
  account: Schema.NullOr(Schema.Finite),
  account_description: NullableString,
  debit: Schema.Finite,
  credit: Schema.Finite,
  total: Schema.Finite,
  project: NullableString,
  cost_center: NullableString
});

export const SupplierInvoiceDetailSchema = Schema.Struct({
  given_number: Schema.String.pipe(describe("Fortnox given number (a string identifier)")),
  supplier_number: NullableString,
  supplier_name: NullableString,
  invoice_number: NullableString,
  invoice_date: NullableString,
  due_date: NullableString,
  total: Schema.Finite,
  balance: Schema.Finite,
  currency: Schema.String,
  ocr: NullableString,
  booked: Schema.Boolean,
  cancelled: Schema.Boolean,
  credit: Schema.Boolean,
  payment_pending: Schema.Boolean,
  comments: NullableString,
  rows: Schema.Array(SupplierInvoiceRowSchema)
});

export type SupplierInvoiceDetail = typeof SupplierInvoiceDetailSchema.Type;

export const ApproveSupplierInvoiceOutput = Schema.Struct({
  ...MutationResult.fields,
  given_number: Schema.String.pipe(describe("Fortnox given number (a string identifier)")),
  supplier_name: NullableString,
  total: Schema.Finite,
  payment_pending: Schema.Boolean
});

const GroupTotalSchema = Schema.Struct({
  count: Schema.Finite,
  total_balance: Schema.Finite
});

export const PayablesReportOutput = Schema.Struct({
  summary: Schema.Struct({
    total_invoices: Schema.Finite,
    total_invoice_amount: Schema.Finite,
    total_payable_balance: Schema.Finite,
    unique_suppliers: Schema.Finite
  }),
  truncated: Schema.Boolean,
  truncation_reason: optionalValue(NullableString),
  by_age_bucket: optionalValue(
    Schema.Array(
      Schema.Struct({
        bucket: Schema.String,
        ...GroupTotalSchema.fields
      })
    )
  ),
  by_supplier: optionalValue(
    Schema.Array(
      Schema.Struct({
        supplier: Schema.String,
        ...GroupTotalSchema.fields
      })
    )
  ),
  invoices: optionalValue(
    Schema.Array(
      Schema.Struct({
        given_number: Schema.String.pipe(describe("Fortnox given number (a string identifier)")),
        supplier_number: NullableString,
        supplier_name: NullableString,
        invoice_number: NullableString,
        invoice_date: NullableString,
        due_date: NullableString,
        total: Schema.Finite,
        balance: Schema.Finite,
        age_bucket: Schema.String
      })
    )
  )
});

export type PayablesReportOutput = typeof PayablesReportOutput.Type;
