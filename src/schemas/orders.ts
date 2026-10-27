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
  period: optional(
    DatePeriodSchema.pipe(
      describe(
        "Convenience date period filter (e.g., 'last_month', 'this_quarter'). Overrides from_date/to_date if provided."
      )
    )
  )
};

const SortOrder = optional(
  Schema.Literals(["ascending", "descending"]).pipe(
    describe("Sort order for results (default 'ascending')")
  )
);

const FetchAll = optional(
  Schema.Boolean.pipe(
    describe(
      "Fetch all results by auto-paginating through all pages. WARNING: May take time for large datasets (max 10,000 results)."
    )
  )
);

const DocumentNumber = (description: string) =>
  Schema.String.pipe(Schema.check(Schema.isMinLength(1)), describe(description));

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
    Schema.Literals(["customername", "customernumber", "documentnumber", "orderdate", "total"]).pipe(
      describe("Field to sort results by")
    )
  ),
  sortorder: SortOrder,
  fetch_all: FetchAll,
  response_format: ResponseFormatSchema
});

export type ListOrdersInput = typeof ListOrdersSchema.Type;

export const GetOrderSchema = Schema.Struct({
  document_number: DocumentNumber("The order document number to retrieve"),
  response_format: ResponseFormatSchema
});

export type GetOrderInput = typeof GetOrderSchema.Type;

export const ListOffersSchema = Schema.Struct({
  ...ListPaginationInput,
  filter: optional(
    Schema.Literals(["cancelled", "expired", "ordercreated", "ordernotcreated"]).pipe(
      describe(
        "Filter offers by status: 'cancelled', 'expired', 'ordercreated', 'ordernotcreated'"
      )
    )
  ),
  ...OrderFilters,
  sortby: optional(
    Schema.Literals(["customername", "customernumber", "documentnumber", "offerdate", "total"]).pipe(
      describe("Field to sort results by")
    )
  ),
  sortorder: SortOrder,
  fetch_all: FetchAll,
  response_format: ResponseFormatSchema
});

export type ListOffersInput = typeof ListOffersSchema.Type;

export const GetOfferSchema = Schema.Struct({
  document_number: DocumentNumber("The offer document number to retrieve"),
  response_format: ResponseFormatSchema
});

export type GetOfferInput = typeof GetOfferSchema.Type;

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
  status: Schema.String.pipe(describe("Derived order status label")),
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
  status: Schema.String.pipe(describe("Derived offer status label")),
  expired: Schema.Boolean,
  order_reference: NullableString
});

const PagedFields = {
  ...PaginationFields,
  next_offset: optionalValue(Schema.Finite)
};

const FetchAllFields = {
  total: Schema.Finite.pipe(describe("Total matching records in Fortnox")),
  count: Schema.Finite.pipe(describe("Records returned")),
  fetched_all: Schema.Boolean.pipe(describe("Always true for an auto-paginated response")),
  pages_fetched: Schema.Finite,
  truncated: Schema.Boolean,
  truncation_reason: optionalValue(NullableString)
};

export const ListOrdersOutput = Schema.Union([
  Schema.Struct({
    ...PagedFields,
    period_description: optionalValue(Schema.String),
    orders: Schema.Array(OrderListItemSchema)
  }),
  Schema.Struct({
    ...FetchAllFields,
    period_description: optionalValue(Schema.String),
    orders: Schema.Array(OrderListItemSchema)
  })
]);

export const ListOffersOutput = Schema.Union([
  Schema.Struct({
    ...PagedFields,
    period_description: optionalValue(Schema.String),
    offers: Schema.Array(OfferListItemSchema)
  }),
  Schema.Struct({
    ...FetchAllFields,
    period_description: optionalValue(Schema.String),
    offers: Schema.Array(OfferListItemSchema)
  })
]);
