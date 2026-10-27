import { Schema } from "effect";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants.js";
import { describe } from "../services/mcpSchema.js";

/**
 * Building blocks shared by the converted domains' Effect schemas.
 *
 * Conventions:
 * - optional arguments are plain `optionalKey`; handlers apply defaults, so
 *   the advertised JSON Schema stays free of `anyOf: [..., null]`.
 * - `Schema.Finite` rather than `Schema.Number` for counts, amounts and ids:
 *   `Number` admits Infinity/NaN and advertises an anyOf union.
 */

/** Input field: the key may be absent. Handlers apply defaults. */
export const optional = <S extends Schema.Constraint>(schema: S) => Schema.optionalKey(schema);

/**
 * Output field: the key may be absent OR explicitly `undefined`. Handlers
 * build plain objects, so conditional fields arrive as `key: undefined`.
 */
export const optionalValue = <S extends Schema.Constraint>(schema: S) => Schema.optional(schema);

export const ResponseFormatSchema = optional(
  Schema.Literals(["markdown", "json"]).pipe(
    describe("markdown|json")
  )
);

export const ShortText = (max: number, description: string) =>
  optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(max)), describe(description)));

export const Email = optional(
  Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)),
    describe("Primary email address")
  )
);

export const NullableString = Schema.NullOr(Schema.String);

/** YYYY-MM-DD date argument (Fortnox accepts nothing else). */
export const DateString = (description: string) =>
  optional(
    Schema.String.pipe(
      Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
      describe(description)
    )
  );

/** Named periods the analytics tools understand. */
export const DATE_PERIODS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year"
] as const;

export const DatePeriodSchema = Schema.Literals(DATE_PERIODS);

export const MutationResult = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String
});

/** The pagination metadata block every list tool returns. */
export const PaginationFields = {
  total: Schema.Finite,
  page: Schema.Finite,
  limit: Schema.Finite,
  count: Schema.Finite,
  has_more: Schema.Boolean,
  total_pages: Schema.Finite
};

export const ListPaginationInput = {
  limit: optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      Schema.check(Schema.isLessThanOrEqualTo(MAX_PAGE_SIZE)),
      describe(`1-${MAX_PAGE_SIZE}, default ${DEFAULT_PAGE_SIZE}`)
    )
  ),
  page: optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      describe("starts at 1")
    )
  )
};
