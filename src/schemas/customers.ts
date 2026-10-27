import { Schema } from "effect";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";
import { describe } from "../services/mcpSchema.js";
import { MutationResult } from "./shared.js";

/**
 * Input and output schemas for the customer tools.
 *
 * Written in Effect Schema; the SDK advertises and validates them through the
 * bridge in `services/mcpSchema.ts`. Optional arguments are plain optionals
 * and defaults are applied in the handlers, which keeps the advertised JSON
 * Schema free of `anyOf: [..., null]` unions.
 */

const optional = <S extends Schema.Constraint>(schema: S) => Schema.optionalKey(schema);

const ResponseFormatSchema = optional(
  Schema.Literals(["markdown", "json"]).pipe(
    describe("Output format: 'markdown' for human-readable or 'json' for structured data")
  )
);

const ShortText = (max: number, description: string) =>
  optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(max)), describe(description)));

const Email = optional(
  Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)),
    describe("Primary email address")
  )
);

export const ListCustomersSchema = Schema.Struct({
  limit: optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      Schema.check(Schema.isLessThanOrEqualTo(MAX_PAGE_SIZE)),
      describe(
        `Maximum number of results to return (1-${MAX_PAGE_SIZE}, default ${DEFAULT_PAGE_SIZE})`
      )
    )
  ),
  page: optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      describe("Page number for pagination (starts at 1)")
    )
  ),
  filter: optional(
    Schema.Literals(["active", "inactive"]).pipe(describe("Filter by customer status"))
  ),
  search_name: ShortText(100, "Search customers by name (partial match)"),
  customer_number: ShortText(50, "Filter by specific customer number"),
  organisation_number: ShortText(50, "Filter by organisation number"),
  response_format: ResponseFormatSchema
});

export type ListCustomersInput = typeof ListCustomersSchema.Type;

export const GetCustomerSchema = Schema.Struct({
  customer_number: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    describe("The customer number to retrieve")
  ),
  response_format: ResponseFormatSchema
});

export type GetCustomerInput = typeof GetCustomerSchema.Type;

export const CreateCustomerSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(1024)),
    describe("Customer name (required)")
  ),
  customer_number: ShortText(50, "Customer number (auto-generated if not provided)"),
  organisation_number: ShortText(30, "Organisation/company number"),
  email: Email,
  phone: ShortText(50, "Primary phone number"),
  address1: ShortText(1024, "Street address line 1"),
  address2: ShortText(1024, "Street address line 2"),
  zip_code: ShortText(10, "Postal/ZIP code"),
  city: ShortText(1024, "City"),
  country: ShortText(50, "Country name"),
  country_code: ShortText(2, "Two-letter country code (e.g., 'SE' for Sweden)"),
  currency: ShortText(3, "Currency code (e.g., 'SEK', 'EUR')"),
  vat_number: ShortText(50, "VAT registration number"),
  vat_type: optional(
    Schema.Literals(["SEVAT", "EUVAT", "EUREVERSEDVAT", "EXPORT"]).pipe(
      describe("VAT type for the customer")
    )
  ),
  terms_of_payment: ShortText(50, "Payment terms code"),
  price_list: ShortText(50, "Price list code"),
  comments: ShortText(1024, "Internal comments about the customer"),
  response_format: ResponseFormatSchema
});

export type CreateCustomerInput = typeof CreateCustomerSchema.Type;

export const UpdateCustomerSchema = Schema.Struct({
  customer_number: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    describe("Customer number to update (required)")
  ),
  name: optional(
    Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(1024)),
      describe("Customer name")
    )
  ),
  organisation_number: ShortText(30, "Organisation/company number"),
  email: Email,
  phone: ShortText(50, "Primary phone number"),
  address1: ShortText(1024, "Street address line 1"),
  address2: ShortText(1024, "Street address line 2"),
  zip_code: ShortText(10, "Postal/ZIP code"),
  city: ShortText(1024, "City"),
  country: ShortText(50, "Country name"),
  country_code: ShortText(2, "Two-letter country code"),
  currency: ShortText(3, "Currency code"),
  vat_number: ShortText(50, "VAT registration number"),
  active: optional(Schema.Boolean.pipe(describe("Whether the customer is active"))),
  terms_of_payment: ShortText(50, "Payment terms code"),
  comments: ShortText(1024, "Internal comments"),
  response_format: ResponseFormatSchema
});

export type UpdateCustomerInput = typeof UpdateCustomerSchema.Type;

export const DeleteCustomerSchema = Schema.Struct({
  customer_number: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    describe("Customer number to delete")
  )
});

export type DeleteCustomerInput = typeof DeleteCustomerSchema.Type;

/* ------------------------------------------------------------------ */
/* Output schemas: the declared shape of each tool's structuredContent */
/* ------------------------------------------------------------------ */

// Schema.Finite, not Schema.Number: Number also admits Infinity/NaN, which
// renders as an anyOf union in the advertised JSON Schema.
const PaginationFields = {
  total: Schema.Finite.pipe(describe("Total matching records in Fortnox")),
  page: Schema.Finite.pipe(describe("Current page")),
  limit: Schema.Finite.pipe(describe("Page size")),
  count: Schema.Finite.pipe(describe("Records in this page")),
  has_more: Schema.Boolean.pipe(describe("Whether more pages exist")),
  total_pages: Schema.Finite.pipe(describe("Total number of pages"))
};

export const CustomerListItemSchema = Schema.Struct({
  customer_number: Schema.String.pipe(describe("Fortnox customer number")),
  name: Schema.String.pipe(describe("Customer name")),
  email: Schema.NullOr(Schema.String),
  city: Schema.NullOr(Schema.String),
  organisation_number: Schema.NullOr(Schema.String)
});

export const ListCustomersOutput = Schema.Struct({
  ...PaginationFields,
  customers: Schema.Array(CustomerListItemSchema)
});

export type ListCustomersOutput = typeof ListCustomersOutput.Type;

export const CustomerDetailSchema = Schema.Struct({
  customer_number: Schema.String,
  name: Schema.String,
  email: Schema.NullOr(Schema.String),
  phone: Schema.NullOr(Schema.String),
  address1: Schema.NullOr(Schema.String),
  address2: Schema.NullOr(Schema.String),
  zip_code: Schema.NullOr(Schema.String),
  city: Schema.NullOr(Schema.String),
  country: Schema.NullOr(Schema.String),
  country_code: Schema.NullOr(Schema.String),
  organisation_number: Schema.NullOr(Schema.String),
  vat_number: Schema.NullOr(Schema.String),
  currency: Schema.NullOr(Schema.String),
  active: Schema.NullOr(Schema.Boolean),
  terms_of_payment: Schema.NullOr(Schema.String),
  comments: Schema.NullOr(Schema.String)
});

export type CustomerDetail = typeof CustomerDetailSchema.Type;

export const CustomerMutationOutput = Schema.Struct({
  ...MutationResult.fields,
  customer_number: Schema.String,
  name: Schema.String
});

export const DeleteCustomerOutput = MutationResult;
