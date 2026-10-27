import { Schema } from "effect";
import { NullableString, ResponseFormatSchema } from "./shared.js";

/**
 * Input and output schemas for the company-information tools.
 */

export const CompanyInfoSchema = Schema.Struct({
  response_format: ResponseFormatSchema
});

export type CompanyInfoInput = typeof CompanyInfoSchema.Type;

export const ListFinancialYearsSchema = Schema.Struct({
  response_format: ResponseFormatSchema
});

export type ListFinancialYearsInput = typeof ListFinancialYearsSchema.Type;

/* ------------------------------- outputs ------------------------------- */

export const CompanyInfoOutput = Schema.Struct({
  company_name: Schema.String,
  organisation_number: Schema.Union([Schema.String, Schema.Finite]),
  // Fortnox documents this as a string but returns a number.
  database_number: Schema.Union([Schema.String, Schema.Finite]),
  address: NullableString,
  zip_code: NullableString,
  city: NullableString,
  country: NullableString,
  country_code: NullableString,
  visit_address: NullableString,
  visit_zip_code: NullableString,
  visit_city: NullableString,
  visit_country: NullableString,
  email: NullableString,
  phone: NullableString,
  phone2: NullableString,
  fax: NullableString,
  website: NullableString
});

export type CompanyInfoOutput = typeof CompanyInfoOutput.Type;

export const FinancialYearSchema = Schema.Struct({
  id: Schema.Finite,
  from_date: Schema.String,
  to_date: Schema.String,
  accounting_method: NullableString
});

export const ListFinancialYearsOutput = Schema.Struct({
  count: Schema.Finite,
  financial_years: Schema.Array(FinancialYearSchema)
});

export type ListFinancialYearsOutput = typeof ListFinancialYearsOutput.Type;
