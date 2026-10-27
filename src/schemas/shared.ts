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

export const optional = <S extends Schema.Constraint>(schema: S) => Schema.optionalKey(schema);

export const ResponseFormatSchema = optional(
  Schema.Literals(["markdown", "json"]).pipe(
    describe("Output format: 'markdown' for human-readable or 'json' for structured data")
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

export const MutationResult = Schema.Struct({
  success: Schema.Boolean.pipe(describe("Whether the operation succeeded")),
  message: Schema.String.pipe(describe("Human-readable result summary"))
});

/** The pagination metadata block every list tool returns. */
export const PaginationFields = {
  total: Schema.Finite.pipe(describe("Total matching records in Fortnox")),
  page: Schema.Finite.pipe(describe("Current page")),
  limit: Schema.Finite.pipe(describe("Page size")),
  count: Schema.Finite.pipe(describe("Records in this page")),
  has_more: Schema.Boolean.pipe(describe("Whether more pages exist")),
  total_pages: Schema.Finite.pipe(describe("Total number of pages"))
};

export const ListPaginationInput = {
  limit: optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      Schema.check(Schema.isLessThanOrEqualTo(MAX_PAGE_SIZE)),
      describe(`Maximum number of results to return (1-${MAX_PAGE_SIZE}, default ${DEFAULT_PAGE_SIZE})`)
    )
  ),
  page: optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      describe("Page number for pagination (starts at 1)")
    )
  )
};
