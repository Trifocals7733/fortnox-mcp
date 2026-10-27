import { Schema } from "effect";
import { describe } from "../services/mcpSchema.js";
import {
  DatePeriodSchema,
  DateString,
  ListPaginationInput,
  MutationResult,
  NullableString,
  PaginationFields,
  ResponseFormatSchema,
  ShortText,
  optional,
  optionalValue
} from "./shared.js";

/**
 * Input and output schemas for the voucher (journal entry) tools.
 */

const AccountNumber = (description: string) =>
  Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1000)),
    Schema.check(Schema.isLessThanOrEqualTo(9999)),
    describe(description)
  );

const FinancialYear = optional(
  Schema.Int.pipe(
    describe(
      "Fortnox year ID (1,2,3...), not a calendar year."
    )
  )
);

const VoucherSeriesCode = (description: string) =>
  Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(2)),
    describe(description)
  );

/** Filter shorthand shared by account_activity and search_vouchers. */
const VoucherFilters = {
  financial_year: FinancialYear,
  period: optional(
    DatePeriodSchema.pipe(
      describe(
        "Named period; overrides from_date/to_date."
      )
    )
  ),
  from_date: DateString("Filter vouchers from this date (YYYY-MM-DD)"),
  to_date: DateString("Filter vouchers to this date (YYYY-MM-DD)"),
  voucher_series: optional(
    Schema.String.pipe(
      Schema.check(Schema.isMaxLength(2)),
      describe("Filter by voucher series (e.g., 'A', 'B')")
    )
  )
};

export const VoucherRowSchema = Schema.Struct({
  account_number: AccountNumber("Account number (1000-9999, required)"),
  debit: optional(
    Schema.Finite.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      describe("Debit amount (use either debit or credit, not both)")
    )
  ),
  credit: optional(
    Schema.Finite.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      describe("Credit amount (use either debit or credit, not both)")
    )
  ),
  description: ShortText(200, "Description for this row"),
  cost_center: ShortText(20, "Cost center code"),
  project: ShortText(20, "Project code")
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (row) =>
        (row.debit !== undefined && row.debit > 0) || (row.credit !== undefined && row.credit > 0),
      { message: "Each row must have either a debit or credit amount greater than 0" }
    )
  )
);

export type VoucherRowInput = typeof VoucherRowSchema.Type;

export const ListVouchersSchema = Schema.Struct({
  ...ListPaginationInput,
  ...VoucherFilters,
  response_format: ResponseFormatSchema
});

export type ListVouchersInput = typeof ListVouchersSchema.Type;

export const GetVoucherSchema = Schema.Struct({
  voucher_series: VoucherSeriesCode("Voucher series (e.g., 'A')"),
  voucher_number: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1)),
    describe("Voucher number within the series")
  ),
  financial_year: FinancialYear,
  response_format: ResponseFormatSchema
});

export type GetVoucherInput = typeof GetVoucherSchema.Type;

export const CreateVoucherSchema = Schema.Struct({
  voucher_series: VoucherSeriesCode("Voucher series (e.g., 'A', 'B') (required)"),
  description: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(200)),
    describe("Voucher description (required)")
  ),
  transaction_date: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
    describe("Transaction date (YYYY-MM-DD, required)")
  ),
  rows: Schema.Array(VoucherRowSchema).pipe(
    Schema.check(Schema.isMinLength(2)),
    describe("Voucher rows (minimum 2 rows required, debit must equal credit)")
  ),
  cost_center: ShortText(20, "Default cost center for all rows"),
  project: ShortText(20, "Default project for all rows"),
  response_format: ResponseFormatSchema
});

export type CreateVoucherInput = typeof CreateVoucherSchema.Type;

export const ListVoucherSeriesSchema = Schema.Struct({
  response_format: ResponseFormatSchema
});

export type ListVoucherSeriesInput = typeof ListVoucherSeriesSchema.Type;

export const AccountActivitySchema = Schema.Struct({
  account_number: optional(AccountNumber("Single account number to filter by (1000-9999)")),
  account_numbers: optional(
    Schema.Array(AccountNumber("Account number")).pipe(
      Schema.check(Schema.isMaxLength(20)),
      describe("Multiple account numbers to filter by (max 20)")
    )
  ),
  account_range: optional(
    Schema.Struct({
      from: AccountNumber("First account number in the range"),
      to: AccountNumber("Last account number in the range")
    }).pipe(describe("Account number range (e.g., 3000-3999 for revenue accounts)"))
  ),
  ...VoucherFilters,
  include_summary: optional(
    Schema.Boolean.pipe(describe("Include totals and summary per account (default true)"))
  ),
  max_vouchers: optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(10)),
      Schema.check(Schema.isLessThanOrEqualTo(500)),
      describe("Maximum vouchers to scan (10-500, default 500). Use date filtering for larger datasets.")
    )
  ),
  response_format: ResponseFormatSchema
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (params) =>
        params.account_number !== undefined ||
        params.account_numbers !== undefined ||
        params.account_range !== undefined,
      { message: "Must specify at least one of: account_number, account_numbers, or account_range" }
    )
  )
);

export type AccountActivityInput = typeof AccountActivitySchema.Type;

export const SearchVouchersSchema = Schema.Struct({
  search_text: Schema.String.pipe(
    Schema.check(Schema.isMinLength(2)),
    Schema.check(Schema.isMaxLength(100)),
    describe("Text to search for in voucher descriptions (min 2 chars)")
  ),
  ...VoucherFilters,
  case_sensitive: optional(
    Schema.Boolean.pipe(describe("Whether search should be case-sensitive (default false)"))
  ),
  include_rows: optional(
    Schema.Boolean.pipe(describe("Include full voucher row details in results (default false)"))
  ),
  max_vouchers: optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(10)),
      Schema.check(Schema.isLessThanOrEqualTo(500)),
      describe("Maximum vouchers to scan (10-500, default 500)")
    )
  ),
  response_format: ResponseFormatSchema
});

export type SearchVouchersInput = typeof SearchVouchersSchema.Type;

/* ------------------------------- outputs ------------------------------- */

export const VoucherListItemSchema = Schema.Struct({
  voucher_series: Schema.String,
  voucher_number: Schema.Finite,
  description: Schema.String,
  transaction_date: Schema.String
});

export const ListVouchersOutput = Schema.Struct({
  ...PaginationFields,
  vouchers: Schema.Array(VoucherListItemSchema)
});

export type ListVouchersOutput = typeof ListVouchersOutput.Type;

export const VoucherRowOutputSchema = Schema.Struct({
  account_number: Schema.Finite,
  debit: Schema.Finite,
  credit: Schema.Finite,
  description: NullableString,
  cost_center: NullableString,
  project: NullableString
});

export const VoucherDetailSchema = Schema.Struct({
  voucher_series: Schema.String,
  voucher_number: Schema.Finite,
  year: Schema.Finite,
  description: Schema.String,
  transaction_date: Schema.String,
  rows: Schema.Array(VoucherRowOutputSchema)
});

export type VoucherDetail = typeof VoucherDetailSchema.Type;

export const CreateVoucherOutput = Schema.Struct({
  ...MutationResult.fields,
  voucher_series: Schema.String,
  voucher_number: Schema.Finite,
  description: Schema.String,
  transaction_date: Schema.String
});

export const VoucherSeriesItemSchema = Schema.Struct({
  code: Schema.String,
  description: Schema.String,
  manual: Schema.Boolean
});

export const ListVoucherSeriesOutput = Schema.Struct({
  count: Schema.Finite,
  series: Schema.Array(VoucherSeriesItemSchema)
});

export const AccountActivityTransactionSchema = Schema.Struct({
  voucher_series: Schema.String,
  voucher_number: Schema.Finite,
  transaction_date: Schema.String,
  voucher_description: Schema.String,
  account: Schema.Finite,
  description: NullableString,
  debit: Schema.Finite,
  credit: Schema.Finite
});

export const AccountActivityOutput = Schema.Struct({
  filter: Schema.Struct({
    accounts: Schema.Array(Schema.Finite),
    account_range: Schema.NullOr(
      Schema.Struct({ from: Schema.Finite, to: Schema.Finite })
    ),
    financial_year: optionalValue(Schema.Finite),
    date_range: NullableString,
    voucher_series: NullableString
  }),
  vouchers_scanned: Schema.Finite,
  total_vouchers_available: Schema.Finite,
  truncated: Schema.Boolean,
  truncation_reason: optionalValue(NullableString),
  matching_transactions: Schema.Finite,
  summary: optionalValue(
    Schema.Array(
      Schema.Struct({
        account: Schema.Finite,
        total_debit: Schema.Finite,
        total_credit: Schema.Finite,
        net_change: Schema.Finite,
        transaction_count: Schema.Finite
      })
    )
  ),
  transactions: Schema.Array(AccountActivityTransactionSchema)
});

export const SearchVouchersOutput = Schema.Struct({
  search_text: Schema.String,
  case_sensitive: optionalValue(Schema.Boolean),
  financial_year: optionalValue(Schema.Finite),
  date_range: NullableString,
  voucher_series: NullableString,
  vouchers_scanned: Schema.Finite,
  total_vouchers_available: Schema.Finite,
  truncated: Schema.Boolean,
  truncation_reason: optionalValue(NullableString),
  matching_count: Schema.Finite,
  vouchers: Schema.Array(Schema.Unknown)
});
