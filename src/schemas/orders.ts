import { Schema } from "effect";
import { describe } from "../services/mcpSchema.js";
import {
  DatePeriodSchema,
  DateString,
  ListPaginationInput,
  NullableString,
  PaginationFields,
  ResponseFormatSchema,
  ShortText,
  optional,
  optionalValue
} from "./shared.js";

/**
 * Input and output schemas for the order/offer tools.
 */

export const OrderFilters = {
  customer_number: ShortText(50, "Filter by customer number"),
  from_date: DateString("Filter from this date (YYYY-MM-DD)"),
  to_date: DateString("Filter to this date (YYYY-MM-DD)"),
  period: optional(DatePeriodSchema.pipe(describe("Named period; overrides from_date/to_date.")))
};

const SortOrder = optional(
  Schema.Literals(["ascending", "descending"]).pipe(describe("default 'ascending'"))
);

const FetchAll = optional(Schema.Boolean.pipe(describe("Auto-paginate up to 10,000 results.")));

export const ListOrdersSchema = Schema.Struct({
  ...ListPaginationInput,
  filter: optional(
    Schema.Literals(["cancelled", "expired", "invoicecreated", "invoicenotcreated"]).pipe(
      describe(
        "Filter orders by status: 'cancelled', 'expired', 'invoicecreated', 'invoicenotcreated'"
      )
    )
  ),
  ...OrderFilters,
  sortby: optional(
    Schema.Literals([
      "customername",
      "customernumber",
      "documentnumber",
      "orderdate",
      "total"
    ]).pipe(describe("Field to sort results by"))
  ),
  sortorder: SortOrder,
  fetch_all: FetchAll,
  response_format: ResponseFormatSchema
});

export type ListOrdersInput = typeof ListOrdersSchema.Type;

export const ListOffersSchema = Schema.Struct({
  ...ListPaginationInput,
  filter: optional(
    Schema.Literals(["cancelled", "expired", "ordercreated", "ordernotcreated"]).pipe(
      describe("Filter offers by status: 'cancelled', 'expired', 'ordercreated', 'ordernotcreated'")
    )
  ),
  ...OrderFilters,
  sortby: optional(
    Schema.Literals([
      "customername",
      "customernumber",
      "documentnumber",
      "offerdate",
      "total"
    ]).pipe(describe("Field to sort results by"))
  ),
  sortorder: SortOrder,
  fetch_all: FetchAll,
  response_format: ResponseFormatSchema
});

export type ListOffersInput = typeof ListOffersSchema.Type;

/* ------------------------------- outputs ------------------------------- */

/*
 * Two response shapes reach the client: a paged one from the plain list call,
 * and a fetch_all one whose metadata block differs (no page/limit/has_more).
 * Hence a union rather than one struct with everything optional.
 */

const OrderListItemSchema = Schema.Struct({
  document_number: Schema.String,
  customer_number: NullableString,
  customer_name: NullableString,
  order_date: NullableString,
  delivery_date: NullableString,
  total: Schema.Finite,
  currency: Schema.String,
  status: Schema.String,
  invoice_reference: NullableString
});

const OfferListItemSchema = Schema.Struct({
  document_number: Schema.String,
  customer_number: NullableString,
  customer_name: NullableString,
  offer_date: NullableString,
  expire_date: NullableString,
  total: Schema.Finite,
  currency: Schema.String,
  status: Schema.String,
  expired: Schema.Boolean,
  order_reference: NullableString
});

const FetchAllFields = {
  total: Schema.Finite,
  count: Schema.Finite,
  fetched_all: Schema.Boolean,
  pages_fetched: Schema.Finite,
  truncated: Schema.Boolean,
  truncation_reason: optionalValue(NullableString)
};

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

export const ListOrdersOutput = Schema.Struct({
  ...ListMeta,
  orders: Schema.Array(OrderListItemSchema)
});

export const ListOffersOutput = Schema.Struct({
  ...ListMeta,
  offers: Schema.Array(OfferListItemSchema)
});
