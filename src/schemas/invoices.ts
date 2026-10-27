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
  ResponseFormatSchema,
  ShortText
} from "./shared.js";

/**
 * Input and output schemas for the invoice tools.
 */

export const InvoiceRowSchema = Schema.Struct({
  article_number: ShortText(50, "Article number from article register"),
  description: Schema.String.pipe(
    Schema.check(Schema.isMaxLength(200)),
    describe("Description of the invoice row")
  ),
  quantity: optional(Schema.Finite.pipe(describe("Quantity (default: 1)"))),
  unit: ShortText(8, "Unit code (e.g., 'st', 'h', 'kg')"),
  price: optional(Schema.Finite.pipe(describe("Unit price excluding VAT"))),
  discount: optional(
    Schema.Finite.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      Schema.check(Schema.isLessThanOrEqualTo(100)),
      describe("Discount percentage (0-100)")
    )
  ),
  account_number: optional(Schema.Int.pipe(describe("Account number for bookkeeping"))),
  vat: optional(Schema.Finite.pipe(describe("VAT percentage (e.g., 25, 12, 6, 0)")))
});

const Amount = optional(
  Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)), describe("Amount in SEK"))
);

const InvoiceFilters = {
  customer_number: ShortText(50, "Filter by customer number"),
  from_date: DateString("Filter invoices from this date (YYYY-MM-DD)"),
  to_date: DateString("Filter invoices to this date (YYYY-MM-DD)"),
  from_final_pay_date: DateString("Filter by due date from (YYYY-MM-DD)"),
  to_final_pay_date: DateString("Filter by due date to (YYYY-MM-DD)"),
  period: optional(DatePeriodSchema.pipe(describe("Named period; overrides from_date/to_date.")))
};

export const ListInvoicesSchema = Schema.Struct({
  ...ListPaginationInput,
  filter: optional(
    Schema.Literals(["cancelled", "fullypaid", "unpaid", "unpaidoverdue", "unbooked"]).pipe(
      describe("Filter invoices by status")
    )
  ),
  ...InvoiceFilters,
  sortby: optional(
    Schema.Literals([
      "customername",
      "customernumber",
      "documentnumber",
      "invoicedate",
      "total"
    ]).pipe(describe("Field to sort results by"))
  ),
  sortorder: optional(
    Schema.Literals(["ascending", "descending"]).pipe(describe("default 'ascending'"))
  ),
  fetch_all: optional(Schema.Boolean.pipe(describe("Auto-paginate up to 10,000 results."))),
  min_amount: optional(
    Schema.Finite.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      describe(
        "Filter invoices with total >= this amount (client-side filter, applied after fetching)"
      )
    )
  ),
  max_amount: optional(
    Schema.Finite.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      describe(
        "Filter invoices with total <= this amount (client-side filter, applied after fetching)"
      )
    )
  ),
  response_format: ResponseFormatSchema
});

export type ListInvoicesInput = typeof ListInvoicesSchema.Type;

export const GetInvoiceSchema = Schema.Struct({
  document_number: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    describe("The invoice document number to retrieve")
  ),
  response_format: ResponseFormatSchema
});

export type GetInvoiceInput = typeof GetInvoiceSchema.Type;

export const CreateInvoiceSchema = Schema.Struct({
  customer_number: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    describe("Customer number (required)")
  ),
  rows: Schema.Array(InvoiceRowSchema).pipe(
    Schema.check(Schema.isMinLength(1)),
    describe("Invoice rows/lines (at least one required)")
  ),
  invoice_date: DateString("Invoice date (YYYY-MM-DD, defaults to today)"),
  due_date: DateString("Due date (YYYY-MM-DD)"),
  our_reference: ShortText(50, "Our reference person"),
  your_reference: ShortText(50, "Customer's reference person"),
  invoice_type: optional(
    Schema.Literals(["INVOICE", "CASH", "CARD", "UNDEFINED"]).pipe(describe("Type of invoice"))
  ),
  currency: ShortText(3, "Currency code (e.g., 'SEK')"),
  terms_of_payment: ShortText(50, "Payment terms code"),
  comments: ShortText(1024, "Comments on the invoice"),
  remarks: ShortText(1024, "Remarks printed on the invoice"),
  freight: Amount,
  administration_fee: optional(
    Schema.Finite.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      describe("Administration fee")
    )
  ),
  send_type: optional(
    Schema.Literals(["EMAIL", "PRINT", "EINVOICE"]).pipe(describe("How to send the invoice"))
  ),
  response_format: ResponseFormatSchema
});

export type CreateInvoiceInput = typeof CreateInvoiceSchema.Type;

export const UpdateInvoiceSchema = Schema.Struct({
  document_number: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    describe("Invoice document number to update (required)")
  ),
  rows: optional(
    Schema.Array(InvoiceRowSchema).pipe(
      Schema.check(Schema.isMinLength(1)),
      describe("Updated invoice rows (replaces all existing rows)")
    )
  ),
  invoice_date: DateString("Invoice date (YYYY-MM-DD)"),
  due_date: DateString("Due date (YYYY-MM-DD)"),
  our_reference: ShortText(50, "Our reference person"),
  your_reference: ShortText(50, "Customer's reference person"),
  comments: ShortText(1024, "Comments on the invoice"),
  remarks: ShortText(1024, "Remarks printed on the invoice"),
  freight: Amount,
  administration_fee: optional(
    Schema.Finite.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      describe("Administration fee")
    )
  ),
  response_format: ResponseFormatSchema
});

export type UpdateInvoiceInput = typeof UpdateInvoiceSchema.Type;

export const InvoiceActionSchema = Schema.Struct({
  document_number: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    describe("Invoice document number")
  ),
  response_format: ResponseFormatSchema
});

export type InvoiceActionInput = typeof InvoiceActionSchema.Type;

export const SendInvoiceEmailSchema = InvoiceActionSchema;
export type SendInvoiceEmailInput = typeof SendInvoiceEmailSchema.Type;

/* ------------------------------- outputs ------------------------------- */

const _FetchAllFields = {
  total: Schema.Finite,
  count: Schema.Finite,
  fetched_all: Schema.Boolean,
  pages_fetched: Schema.Finite,
  truncated: Schema.Boolean,
  truncation_reason: optionalValue(NullableString)
};

const InvoiceListItemSchema = Schema.Struct({
  document_number: Schema.String,
  customer_number: NullableString,
  customer_name: NullableString,
  invoice_date: NullableString,
  due_date: NullableString,
  total: Schema.Finite,
  balance: Schema.Finite,
  currency: Schema.String,
  booked: Schema.Boolean,
  cancelled: Schema.Boolean
});

/**
 * Paged and fetch_all answers differ in which metadata keys they carry, so the
 * merged shape makes every variant key optional. A union of the two shapes
 * would repeat the shared fields and cost ~700 chars per tool in tools/list,
 * which the client pays on each connect.
 */
const ListMeta = {
  total: Schema.Finite,
  count: Schema.Finite,
  page: optionalValue(Schema.Finite),
  limit: optionalValue(Schema.Finite),
  has_more: optionalValue(Schema.Boolean),
  total_pages: optionalValue(Schema.Finite),
  fetched_all: optionalValue(Schema.Boolean),
  pages_fetched: optionalValue(Schema.Finite),
  truncated: optionalValue(Schema.Boolean),
  truncation_reason: optionalValue(Schema.NullOr(Schema.String)),
  next_offset: optionalValue(Schema.Finite),
  period_description: optionalValue(Schema.String)
};

export const ListInvoicesOutput = Schema.Struct({
  ...ListMeta,
  invoices: Schema.Array(InvoiceListItemSchema)
});

const InvoiceRowOutputSchema = Schema.Struct({
  article_number: NullableString,
  description: NullableString,
  quantity: Schema.Finite,
  unit: NullableString,
  price: Schema.Finite,
  discount: Schema.Finite,
  total: Schema.Finite,
  vat: Schema.Finite,
  account_number: Schema.NullOr(Schema.Finite)
});

export const InvoiceDetailSchema = Schema.Struct({
  document_number: Schema.String,
  customer_number: NullableString,
  customer_name: NullableString,
  invoice_date: NullableString,
  due_date: NullableString,
  total: Schema.Finite,
  balance: Schema.Finite,
  currency: Schema.String,
  ocr: NullableString,
  our_reference: NullableString,
  your_reference: NullableString,
  booked: Schema.Boolean,
  cancelled: Schema.Boolean,
  sent: Schema.Boolean,
  comments: NullableString,
  remarks: NullableString,
  rows: Schema.Array(InvoiceRowOutputSchema)
});

export type InvoiceDetail = typeof InvoiceDetailSchema.Type;

export const CreateInvoiceOutput = Schema.Struct({
  ...MutationResult.fields,
  document_number: Schema.String,
  customer_number: NullableString,
  customer_name: NullableString,
  total: Schema.Finite,
  currency: Schema.String
});

export const UpdateInvoiceOutput = Schema.Struct({
  ...MutationResult.fields,
  document_number: Schema.String,
  total: Schema.Finite
});

export const BookkeepInvoiceOutput = Schema.Struct({
  ...MutationResult.fields,
  document_number: Schema.String,
  booked: Schema.Boolean
});

export const CancelInvoiceOutput = Schema.Struct({
  ...MutationResult.fields,
  document_number: Schema.String,
  cancelled: Schema.Boolean
});

export const CreditInvoiceOutput = Schema.Struct({
  ...MutationResult.fields,
  original_document_number: Schema.String,
  credit_document_number: Schema.String,
  total: Schema.Finite
});

export const SendInvoiceEmailOutput = Schema.Struct({
  ...MutationResult.fields,
  document_number: Schema.String,
  sent: Schema.Boolean
});
