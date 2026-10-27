import { Schema } from "effect";
import { describe } from "../services/mcpSchema.js";
import {
  Email,
  ListPaginationInput,
  MutationResult,
  NullableString,
  PaginationFields,
  ResponseFormatSchema,
  ShortText,
  optional
} from "./shared.js";

/**
 * Input and output schemas for the supplier tools (Effect Schema, bridged to
 * the MCP SDK by `services/mcpSchema.ts`).
 */

export const ListSuppliersSchema = Schema.Struct({
  ...ListPaginationInput,
  filter: optional(
    Schema.Literals(["active", "inactive"]).pipe(describe("Filter by supplier status"))
  ),
  search_name: ShortText(100, "Search suppliers by name (partial match)"),
  response_format: ResponseFormatSchema
});

export type ListSuppliersInput = typeof ListSuppliersSchema.Type;

export const GetSupplierSchema = Schema.Struct({
  supplier_number: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    describe("The supplier number to retrieve")
  ),
  response_format: ResponseFormatSchema
});

export type GetSupplierInput = typeof GetSupplierSchema.Type;

export const CreateSupplierSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(1024)),
    describe("Supplier name (required)")
  ),
  supplier_number: ShortText(50, "Supplier number (auto-generated if not provided)"),
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
  bank_account: ShortText(50, "Bank account number"),
  bg_number: ShortText(20, "Bankgiro number"),
  pg_number: ShortText(20, "Plusgiro number"),
  terms_of_payment: ShortText(50, "Payment terms code"),
  comments: ShortText(1024, "Internal comments about the supplier"),
  response_format: ResponseFormatSchema
});

export type CreateSupplierInput = typeof CreateSupplierSchema.Type;

export const UpdateSupplierSchema = Schema.Struct({
  supplier_number: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    describe("Supplier number to update (required)")
  ),
  name: optional(
    Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(1024)),
      describe("Supplier name")
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
  active: optional(Schema.Boolean.pipe(describe("Whether the supplier is active"))),
  bank_account: ShortText(50, "Bank account number"),
  bg_number: ShortText(20, "Bankgiro number"),
  pg_number: ShortText(20, "Plusgiro number"),
  terms_of_payment: ShortText(50, "Payment terms code"),
  comments: ShortText(1024, "Internal comments"),
  response_format: ResponseFormatSchema
});

export type UpdateSupplierInput = typeof UpdateSupplierSchema.Type;

export const DeleteSupplierSchema = Schema.Struct({
  supplier_number: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    describe("Supplier number to delete")
  )
});

export type DeleteSupplierInput = typeof DeleteSupplierSchema.Type;

/* ------------------------------- outputs ------------------------------- */

export const SupplierListItemSchema = Schema.Struct({
  supplier_number: Schema.String,
  name: Schema.String,
  email: NullableString,
  city: NullableString,
  organisation_number: NullableString
});

export const ListSuppliersOutput = Schema.Struct({
  ...PaginationFields,
  suppliers: Schema.Array(SupplierListItemSchema)
});

export type ListSuppliersOutput = typeof ListSuppliersOutput.Type;

export const SupplierDetailSchema = Schema.Struct({
  supplier_number: Schema.String,
  name: Schema.String,
  email: NullableString,
  phone: NullableString,
  address1: NullableString,
  address2: NullableString,
  zip_code: NullableString,
  city: NullableString,
  country: NullableString,
  organisation_number: NullableString,
  vat_number: NullableString,
  currency: NullableString,
  active: Schema.Boolean,
  bank_account: NullableString,
  bg_number: NullableString,
  pg_number: NullableString,
  terms_of_payment: NullableString,
  comments: NullableString
});

export type SupplierDetail = typeof SupplierDetailSchema.Type;

export const SupplierMutationOutput = Schema.Struct({
  ...MutationResult.fields,
  supplier_number: Schema.String,
  name: Schema.String
});

export const DeleteSupplierOutput = MutationResult;
