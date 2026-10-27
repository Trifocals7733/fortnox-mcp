import { Schema } from "effect";
import { describe } from "../services/mcpSchema.js";
import {
  ListPaginationInput,
  MutationResult,
  PaginationFields,
  ResponseFormatSchema,
  ShortText,
  optional
} from "./shared.js";

/**
 * Input and output schemas for the chart-of-accounts tools.
 */

const AccountNumber = (description: string) =>
  Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1000)),
    Schema.check(Schema.isLessThanOrEqualTo(9999)),
    describe(description)
  );

const SettingValue = Schema.Literals(["ALLOWED", "MANDATORY", "NOTALLOWED"]);

export const ListAccountsSchema = Schema.Struct({
  ...ListPaginationInput,
  search_description: ShortText(100, "Search accounts by description"),
  from_account: optional(AccountNumber("Filter accounts from this account number")),
  to_account: optional(AccountNumber("Filter accounts to this account number")),
  response_format: ResponseFormatSchema
});

export type ListAccountsInput = typeof ListAccountsSchema.Type;

export const GetAccountSchema = Schema.Struct({
  account_number: AccountNumber("The account number to retrieve (1000-9999)"),
  response_format: ResponseFormatSchema
});

export type GetAccountInput = typeof GetAccountSchema.Type;

export const CreateAccountSchema = Schema.Struct({
  account_number: AccountNumber("Account number (1000-9999, required)"),
  description: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(200)),
    describe("Account description (required)")
  ),
  vat_code: ShortText(10, "VAT code for the account"),
  active: optional(
    Schema.Boolean.pipe(describe("Whether the account is active (default true)"))
  ),
  cost_center_settings: optional(
    SettingValue.pipe(describe("Cost center settings for the account"))
  ),
  project_settings: optional(SettingValue.pipe(describe("Project settings for the account"))),
  sru_code: optional(Schema.Int.pipe(describe("SRU code for tax reporting"))),
  response_format: ResponseFormatSchema
});

export type CreateAccountInput = typeof CreateAccountSchema.Type;

export const UpdateAccountSchema = Schema.Struct({
  account_number: AccountNumber("Account number to update (required)"),
  description: optional(
    Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(200)),
      describe("Account description")
    )
  ),
  vat_code: ShortText(10, "VAT code for the account"),
  active: optional(Schema.Boolean.pipe(describe("Whether the account is active"))),
  cost_center_settings: optional(SettingValue.pipe(describe("Cost center settings"))),
  project_settings: optional(SettingValue.pipe(describe("Project settings"))),
  response_format: ResponseFormatSchema
});

export type UpdateAccountInput = typeof UpdateAccountSchema.Type;

export const DeleteAccountSchema = Schema.Struct({
  account_number: AccountNumber("Account number to delete")
});

export type DeleteAccountInput = typeof DeleteAccountSchema.Type;

/* ------------------------------- outputs ------------------------------- */

export const AccountListItemSchema = Schema.Struct({
  account_number: Schema.Finite,
  description: Schema.String,
  active: Schema.Boolean
});

export const ListAccountsOutput = Schema.Struct({
  ...PaginationFields,
  accounts: Schema.Array(AccountListItemSchema)
});

export type ListAccountsOutput = typeof ListAccountsOutput.Type;

export const AccountDetailSchema = Schema.Struct({
  account_number: Schema.Finite,
  description: Schema.String,
  active: Schema.Boolean,
  vat_code: Schema.NullOr(Schema.String),
  balance_brought_forward: Schema.Finite,
  balance_carried_forward: Schema.Finite,
  cost_center_settings: Schema.NullOr(Schema.String),
  project_settings: Schema.NullOr(Schema.String),
  sru_code: Schema.NullOr(Schema.String),
  year: Schema.NullOr(Schema.Finite)
});

export type AccountDetail = typeof AccountDetailSchema.Type;

export const AccountMutationOutput = Schema.Struct({
  ...MutationResult.fields,
  account_number: Schema.Finite,
  description: Schema.String
});

export const DeleteAccountOutput = MutationResult;
