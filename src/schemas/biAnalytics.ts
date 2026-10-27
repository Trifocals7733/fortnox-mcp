import { Schema } from "effect";
import { describe } from "../services/mcpSchema.js";
import {
  DATE_PERIODS,
  DatePeriodSchema,
  DateString,
  NullableString,
  ResponseFormatSchema,
  ShortText,
  optional,
  optionalValue
} from "./shared.js";

/**
 * Input and output schemas for the business-intelligence tools.
 *
 * Inputs are fully modelled. Several of these tools return collections whose
 * element shapes are built by aggregation helpers; those are declared as
 * `Schema.Array(Schema.Unknown)` rather than guessed - a wrong element schema
 * fails at runtime, and most of these tools have no data in the test company
 * yet, so a guess would only look correct while the array is empty.
 */

const Period = optional(DatePeriodSchema.pipe(describe("Named period, e.g. 'this_month'")));
const FromDate = DateString("YYYY-MM-DD; ignored if period set.");
const ToDate = DateString("YYYY-MM-DD; ignored if period set.");
const AccountRangeFrom = optional(
  Schema.Int.pipe(describe("First account number in the range (defaults to the tool's own range)"))
);
const AccountRangeTo = optional(
  Schema.Int.pipe(describe("Last account number in the range (defaults to the tool's own range)"))
);

const PeriodsAndRange = { period: Period, from_date: FromDate, to_date: ToDate };

export const CashFlowForecastSchema = Schema.Struct({
  horizon_days: optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      Schema.check(Schema.isLessThanOrEqualTo(365)),
      describe("Number of days to forecast ahead (1-365, default: 90)")
    )
  ),
  group_by: optional(
    Schema.Literals(["week", "month"]).pipe(
      describe("How to group the forecast: 'week' or 'month' (default 'week')")
    )
  ),
  include_overdue: optional(
    Schema.Boolean.pipe(
      describe("Include overdue receivables and payables in the forecast (default true)")
    )
  ),
  starting_balance: optional(
    Schema.Finite.pipe(describe("Optional starting cash balance to use for projection"))
  ),
  response_format: ResponseFormatSchema
});

export type CashFlowForecastInput = typeof CashFlowForecastSchema.Type;

export const OrderPipelineSchema = Schema.Struct({
  ...PeriodsAndRange,
  group_by: optional(
    Schema.Literals(["customer", "month", "status"]).pipe(
      describe("Group pipeline statistics by this dimension")
    )
  ),
  response_format: ResponseFormatSchema
});

export type OrderPipelineInput = typeof OrderPipelineSchema.Type;

export const SalesFunnelSchema = Schema.Struct({
  ...PeriodsAndRange,
  response_format: ResponseFormatSchema
});

export type SalesFunnelInput = typeof SalesFunnelSchema.Type;

export const ProductPerformanceSchema = Schema.Struct({
  ...PeriodsAndRange,
  metric: optional(
    Schema.Literals(["revenue", "quantity", "invoice_count"]).pipe(
      describe("Metric to rank products by")
    )
  ),
  top_n: optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      Schema.check(Schema.isLessThanOrEqualTo(100)),
      describe("Number of top items to return (default 10)")
    )
  ),
  include_trends: optional(
    Schema.Boolean.pipe(describe("Include trend information (default false)"))
  ),
  response_format: ResponseFormatSchema
});

export type ProductPerformanceInput = typeof ProductPerformanceSchema.Type;

export const PeriodComparisonSchema = Schema.Struct({
  current_period: optional(
    DatePeriodSchema.pipe(describe("Current period to analyse (default 'this_month')"))
  ),
  compare_to: optional(
    DatePeriodSchema.pipe(describe("Period to compare against (defaults to the previous one)"))
  ),
  metrics: optional(
    Schema.Array(
      Schema.Literals(["revenue", "invoice_count", "average_invoice", "new_customers"])
    ).pipe(describe("Metrics to compare"))
  ),
  response_format: ResponseFormatSchema
});

export type PeriodComparisonInput = typeof PeriodComparisonSchema.Type;

export const CustomerGrowthSchema = Schema.Struct({
  current_period: optional(
    DatePeriodSchema.pipe(describe("Current period to analyse (default 'this_month')"))
  ),
  compare_to: optional(DatePeriodSchema.pipe(describe("Period to compare against"))),
  min_revenue: optional(
    Schema.Finite.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0)),
      describe("Only include customers above this revenue")
    )
  ),
  top_n: optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1)),
      Schema.check(Schema.isLessThanOrEqualTo(100)),
      describe("Number of customers to return (default 20)")
    )
  ),
  show: optional(
    Schema.Literals(["growing", "declining", "all"]).pipe(
      describe("Which customers to show (default 'all')")
    )
  ),
  response_format: ResponseFormatSchema
});

export type CustomerGrowthInput = typeof CustomerGrowthSchema.Type;

export const ProjectProfitabilitySchema = Schema.Struct({
  project_number: ShortText(50, "Limit to a single project number"),
  ...PeriodsAndRange,
  include_details: optional(
    Schema.Boolean.pipe(describe("Include per-project detail (default true)"))
  ),
  response_format: ResponseFormatSchema
});

export type ProjectProfitabilityInput = typeof ProjectProfitabilitySchema.Type;

export const CostCenterAnalysisSchema = Schema.Struct({
  ...PeriodsAndRange,
  cost_center: ShortText(50, "Limit to a single cost center code"),
  account_range_from: AccountRangeFrom,
  account_range_to: AccountRangeTo,
  response_format: ResponseFormatSchema
});

export type CostCenterAnalysisInput = typeof CostCenterAnalysisSchema.Type;

export const ExpenseAnalysisSchema = Schema.Struct({
  ...PeriodsAndRange,
  account_range_from: AccountRangeFrom,
  account_range_to: AccountRangeTo,
  group_by: optional(
    Schema.Literals(["account", "account_class"]).pipe(
      describe("How to group expenses (default 'account_class')")
    )
  ),
  compare_to: optional(DatePeriodSchema.pipe(describe("Optional period to compare against"))),
  response_format: ResponseFormatSchema
});

export type ExpenseAnalysisInput = typeof ExpenseAnalysisSchema.Type;

export const YearlyComparisonSchema = Schema.Struct({
  years: optional(
    Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(2)),
      Schema.check(Schema.isLessThanOrEqualTo(5)),
      describe("Number of years to compare (2-5, default: 3)")
    )
  ),
  metrics: optional(
    Schema.Array(
      Schema.Literals(["revenue", "invoice_count", "average_invoice", "customer_count"])
    ).pipe(describe("Metrics to compare across years (default ['revenue','invoice_count'])"))
  ),
  response_format: ResponseFormatSchema
});

export type YearlyComparisonInput = typeof YearlyComparisonSchema.Type;

export const GrossMarginTrendSchema = Schema.Struct({
  ...PeriodsAndRange,
  group_by: optional(
    Schema.Literals(["month", "quarter"]).pipe(
      describe("How to group the margin trend: 'month' or 'quarter' (default 'month')")
    )
  ),
  revenue_accounts: ShortText(20, "Revenue account range (e.g., '3000-3999'). Default: 3000-3999"),
  cogs_accounts: ShortText(
    20,
    "Cost of goods sold account range (e.g., '4000-4999'). Default: 4000-4999"
  ),
  response_format: ResponseFormatSchema
});

export type GrossMarginTrendInput = typeof GrossMarginTrendSchema.Type;

/* ------------------------------- outputs ------------------------------- */

/** Collections whose element shapes come from aggregation helpers. */
const OpaqueItems = Schema.Array(Schema.Unknown);

const Truncation = {
  truncated: Schema.Boolean,
  truncation_reason: optionalValue(NullableString)
};

export const CashFlowForecastOutput = Schema.Struct({
  forecast: Schema.Struct({
    horizon_days: optionalValue(Schema.Finite),
    group_by: optionalValue(Schema.String),
    from_date: Schema.String,
    to_date: Schema.String,
    include_overdue: optionalValue(Schema.Boolean),
    starting_balance: Schema.Finite
  }),
  summary: Schema.Struct({
    total_receivables: Schema.Finite,
    total_payables: Schema.Finite,
    net_position: Schema.Finite,
    receivables_count: Schema.Finite,
    payables_count: Schema.Finite,
    ending_balance: Schema.Finite
  }),
  periods: OpaqueItems,
  ...Truncation,
  warning: optionalValue(Schema.String)
});

export const OrderPipelineOutput = Schema.Struct({
  period: NullableString,
  date_range: NullableString,
  group_by: optionalValue(Schema.String),
  summary: Schema.Struct({
    total_orders: Schema.Finite,
    total_value: Schema.Finite,
    pending_orders: Schema.Finite,
    pending_value: Schema.Finite,
    invoiced_orders: Schema.Finite,
    invoiced_value: Schema.Finite,
    cancelled_orders: Schema.Finite,
    unique_customers: Schema.Finite
  }),
  groups: OpaqueItems,
  ...Truncation
});

const FunnelStage = Schema.Struct({
  count: Schema.Finite,
  value: Schema.Finite
});

export const SalesFunnelOutput = Schema.Struct({
  period: NullableString,
  date_range: NullableString,
  funnel: Schema.Struct({
    offers: Schema.Struct({ ...FunnelStage.fields, converted: Schema.Finite, open: Schema.Finite }),
    orders: Schema.Struct({ ...FunnelStage.fields, converted: Schema.Finite, open: Schema.Finite }),
    invoices: FunnelStage
  }),
  conversion_rates: Schema.Struct({
    offer_to_order: Schema.Finite,
    order_to_invoice: Schema.Finite,
    overall: Schema.Finite
  }),
  truncated: Schema.Boolean
});

export const ProductPerformanceOutput = Schema.Struct({
  period: NullableString,
  date_range: NullableString,
  metric: optionalValue(Schema.String),
  summary: Schema.Struct({
    total_revenue: Schema.Finite,
    total_invoices: Schema.Finite,
    unique_customers: Schema.Finite
  }),
  top_performers: Schema.Array(
    Schema.Struct({
      rank: Schema.Finite,
      identifier: NullableString,
      name: NullableString,
      revenue: Schema.Finite,
      invoice_count: Schema.Finite
    })
  ),
  note: Schema.String,
  truncated: Schema.Boolean
});

const DateRange = Schema.Struct({
  from_date: Schema.String,
  to_date: Schema.String
});

const ComparedPeriod = Schema.Struct({
  period: Schema.String,
  description: Schema.String,
  date_range: DateRange,
  metrics: Schema.Unknown
});

/** comparison is keyed by metric name, not a list. */
const GrowthResultSchema = Schema.Struct({
  current: Schema.Finite,
  previous: Schema.Finite,
  change: Schema.Finite,
  percentChange: Schema.Finite,
  trend: Schema.Literals(["up", "down", "flat"])
});

export const PeriodComparisonOutput = Schema.Struct({
  current_period: ComparedPeriod,
  previous_period: ComparedPeriod,
  comparison: Schema.Record(Schema.String, GrowthResultSchema),
  truncated: Schema.Boolean
});

export const CustomerGrowthOutput = Schema.Struct({
  current_period: Schema.Unknown,
  previous_period: Schema.Unknown,
  filter: optionalValue(Schema.String),
  summary: Schema.Struct({
    total_customers_analyzed: Schema.Finite,
    growing_customers: Schema.Finite,
    declining_customers: Schema.Finite,
    flat_customers: Schema.Finite
  }),
  customers: OpaqueItems,
  truncated: Schema.Boolean
});

/** Early return when the company has no projects (or the requested one). */
const NoProjectsOutput = Schema.Struct({
  message: Schema.String,
  projects: OpaqueItems
});

export const ProjectProfitabilityOutput = Schema.Union([
  Schema.Struct({
    period: NullableString,
    date_range: NullableString,
    note: Schema.String,
    projects: OpaqueItems,
    truncated: Schema.Boolean
  }),
  NoProjectsOutput
]);

export const CostCenterAnalysisOutput = Schema.Struct({
  period: NullableString,
  date_range: NullableString,
  account_range: Schema.NullOr(
    Schema.Struct({
      from: optionalValue(Schema.Finite),
      to: optionalValue(Schema.Finite)
    })
  ),
  note: Schema.String,
  cost_centers: OpaqueItems,
  truncated: Schema.Boolean
});

export const ExpenseAnalysisOutput = Schema.Struct({
  period: NullableString,
  date_range: NullableString,
  account_range: Schema.Struct({
    from: optionalValue(Schema.Finite),
    to: optionalValue(Schema.Finite)
  }),
  group_by: optionalValue(Schema.String),
  note: Schema.String,
  expense_classes: OpaqueItems,
  comparison_period: NullableString
});

export const YearlyComparisonOutput = Schema.Struct({
  years_compared: optionalValue(Schema.Finite),
  metrics: optionalValue(Schema.Array(Schema.String)),
  years: OpaqueItems,
  truncated: Schema.Boolean
});

export const GrossMarginTrendOutput = Schema.Struct({
  period: NullableString,
  date_range: NullableString,
  group_by: optionalValue(Schema.String),
  account_ranges: Schema.Struct({
    revenue: Schema.String,
    cogs: Schema.String
  }),
  note: Schema.String,
  periods: Schema.Array(
    Schema.Struct({
      period: Schema.String,
      revenue: Schema.Finite,
      cogs: Schema.Finite,
      gross_margin: Schema.Finite,
      margin_percent: Schema.Finite
    })
  )
});

export { DATE_PERIODS };
