import { McpServer } from "@modelcontextprotocol/server";
import { fortnoxRequest, fetchAllPages } from "../services/api.js";
import { ResponseFormat, FETCH_ALL_DELAY_MS, DEFAULT_PAGE_SIZE } from "../constants.js";
import { mcpSchema } from "../services/mcpSchema.js";
import {
  buildToolResponse,
  buildErrorResponse,
  formatMoney,
  formatDisplayDate,
  formatListMarkdown,
  buildPaginationMeta
} from "../services/formatters.js";
import { periodToDateRange, getPeriodDescription } from "../services/dateHelpers.js";
import {
  ListVouchersSchema,
  GetVoucherSchema,
  CreateVoucherSchema,
  ListVoucherSeriesSchema,
  AccountActivitySchema,
  SearchVouchersSchema,
  type ListVouchersInput,
  type GetVoucherInput,
  type CreateVoucherInput,
  type ListVoucherSeriesInput,
  type AccountActivityInput,
  type SearchVouchersInput,
  ListVouchersOutput,
  VoucherDetailSchema,
  CreateVoucherOutput,
  ListVoucherSeriesOutput,
  AccountActivityOutput,
  SearchVouchersOutput
} from "../schemas/vouchers.js";

// API response types
interface FortnoxVoucherRow {
  Account: number;
  Debit?: number;
  Credit?: number;
  Description?: string;
  CostCenter?: string;
  Project?: string;
}

interface FortnoxVoucher {
  VoucherSeries: string;
  VoucherNumber: number;
  Year: number;
  Description: string;
  TransactionDate: string;
  VoucherRows?: FortnoxVoucherRow[];
  "@url"?: string;
}

interface FortnoxVoucherListItem {
  VoucherSeries: string;
  VoucherNumber: number;
  Description: string;
  TransactionDate: string;
  "@url"?: string;
}

interface VoucherListResponse {
  Vouchers: FortnoxVoucherListItem[];
  MetaInformation?: {
    "@TotalResources": number;
    "@TotalPages": number;
    "@CurrentPage": number;
  };
}

interface VoucherResponse {
  Voucher: FortnoxVoucher;
}

interface FortnoxVoucherSeries {
  Code: string;
  Description: string;
  Manual?: boolean;
  "@url"?: string;
}

interface VoucherSeriesListResponse {
  VoucherSeriesCollection: FortnoxVoucherSeries[];
}

/**
 * Register all voucher-related tools
 */
export function registerVoucherTools(server: McpServer): void {
  // List vouchers
  server.registerTool(
    "fortnox_list_vouchers",
    {
      title: "List Fortnox Vouchers",
      description: `Vouchers (accounting entries), filterable by series, financial year and date. financial_year is Fortnox's sequential ID, not a calendar year.`,
      inputSchema: mcpSchema(ListVouchersSchema),
      outputSchema: mcpSchema(ListVouchersOutput),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: ListVouchersInput) => {
      try {
        let endpoint = "/3/vouchers";
        const queryParams: Record<string, string | number | boolean | undefined> = {
          limit: params.limit ?? DEFAULT_PAGE_SIZE,
          page: params.page ?? 1
        };

        // Use sublist endpoint if filtering by series
        if (params.voucher_series) {
          endpoint = `/3/vouchers/sublist/${encodeURIComponent(params.voucher_series)}`;
        }

        queryParams.financialyear = params.financial_year;
        if (params.from_date) queryParams.fromdate = params.from_date;
        if (params.to_date) queryParams.todate = params.to_date;

        const response = await fortnoxRequest<VoucherListResponse>(
          endpoint,
          "GET",
          undefined,
          queryParams
        );
        const vouchers = response.Vouchers || [];
        const total = response.MetaInformation?.["@TotalResources"] || vouchers.length;

        const output = {
          ...buildPaginationMeta(
            total,
            params.page ?? 1,
            params.limit ?? DEFAULT_PAGE_SIZE,
            vouchers.length
          ),
          vouchers: vouchers.map((v) => ({
            voucher_series: v.VoucherSeries,
            voucher_number: v.VoucherNumber,
            description: v.Description,
            transaction_date: v.TransactionDate
          }))
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = formatListMarkdown(
            "Vouchers",
            vouchers,
            total,
            params.page ?? 1,
            params.limit ?? DEFAULT_PAGE_SIZE,
            (v) =>
              `- **${v.VoucherSeries}${v.VoucherNumber}** (${formatDisplayDate(v.TransactionDate)}): ${v.Description}`
          );
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Get single voucher
  server.registerTool(
    "fortnox_get_voucher",
    {
      title: "Get Fortnox Voucher",
      description: `One voucher with all of its accounting rows. financial_year is Fortnox's sequential ID (1, 2, 3...), not a calendar year.`,
      inputSchema: mcpSchema(GetVoucherSchema),
      outputSchema: mcpSchema(VoucherDetailSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: GetVoucherInput) => {
      try {
        let endpoint = `/3/vouchers/${encodeURIComponent(params.voucher_series)}/${params.voucher_number}`;
        const queryParams: Record<string, string | number | boolean | undefined> = {};

        if (params.financial_year) {
          queryParams.financialyear = params.financial_year;
        }

        const response = await fortnoxRequest<VoucherResponse>(
          endpoint,
          "GET",
          undefined,
          queryParams
        );
        const voucher = response.Voucher;

        const output = {
          voucher_series: voucher.VoucherSeries,
          voucher_number: voucher.VoucherNumber,
          year: voucher.Year,
          description: voucher.Description,
          transaction_date: voucher.TransactionDate,
          rows: (voucher.VoucherRows || []).map((row) => ({
            account_number: row.Account,
            debit: row.Debit || 0,
            credit: row.Credit || 0,
            description: row.Description || null,
            cost_center: row.CostCenter || null,
            project: row.Project || null
          }))
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          const lines = [
            `# Voucher ${voucher.VoucherSeries}${voucher.VoucherNumber}`,
            "",
            `**Description**: ${voucher.Description}`,
            `**Date**: ${formatDisplayDate(voucher.TransactionDate)}`,
            `**Year**: ${voucher.Year}`,
            "",
            "## Accounting Rows",
            "",
            "| Account | Description | Debit | Credit |",
            "|---------|-------------|-------|--------|"
          ];

          let totalDebit = 0;
          let totalCredit = 0;

          for (const row of voucher.VoucherRows || []) {
            totalDebit += row.Debit || 0;
            totalCredit += row.Credit || 0;
            lines.push(
              `| ${row.Account} | ${row.Description || "-"} | ${formatMoney(row.Debit || 0)} | ${formatMoney(row.Credit || 0)} |`
            );
          }

          lines.push(
            `| **Total** | | **${formatMoney(totalDebit)}** | **${formatMoney(totalCredit)}** |`
          );

          textContent = lines.join("\n");
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Create voucher
  server.registerTool(
    "fortnox_create_voucher",
    {
      title: "Create Fortnox Voucher",
      description: `Create a manual voucher (journal entry). Debits must equal credits and at least two rows are required; the financial year must exist.`,
      inputSchema: mcpSchema(CreateVoucherSchema),
      outputSchema: mcpSchema(CreateVoucherOutput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: CreateVoucherInput) => {
      try {
        // Validate that debits equal credits
        let totalDebit = 0;
        let totalCredit = 0;
        for (const row of params.rows) {
          totalDebit += row.debit || 0;
          totalCredit += row.credit || 0;
        }

        if (Math.abs(totalDebit - totalCredit) > 0.01) {
          return buildErrorResponse(
            new Error(
              `Voucher is not balanced. Total debit (${totalDebit}) must equal total credit (${totalCredit}).`
            )
          );
        }

        const voucherData: Record<string, unknown> = {
          VoucherSeries: params.voucher_series,
          Description: params.description,
          TransactionDate: params.transaction_date,
          VoucherRows: params.rows.map((row) => {
            const voucherRow: Record<string, unknown> = {
              Account: row.account_number
            };
            if (row.debit !== undefined && row.debit > 0) voucherRow.Debit = row.debit;
            if (row.credit !== undefined && row.credit > 0) voucherRow.Credit = row.credit;
            if (row.description) voucherRow.Description = row.description;
            if (row.cost_center || params.cost_center) {
              voucherRow.CostCenter = row.cost_center || params.cost_center;
            }
            if (row.project || params.project) {
              voucherRow.Project = row.project || params.project;
            }
            return voucherRow;
          })
        };

        const response = await fortnoxRequest<VoucherResponse>("/3/vouchers", "POST", {
          Voucher: voucherData
        });
        const voucher = response.Voucher;

        const output = {
          success: true,
          message: `Voucher ${voucher.VoucherSeries}${voucher.VoucherNumber} created successfully`,
          voucher_series: voucher.VoucherSeries,
          voucher_number: voucher.VoucherNumber,
          description: voucher.Description,
          transaction_date: voucher.TransactionDate
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent =
            `# Voucher Created\n\n` +
            `**Voucher**: ${voucher.VoucherSeries}${voucher.VoucherNumber}\n` +
            `**Description**: ${voucher.Description}\n` +
            `**Date**: ${formatDisplayDate(voucher.TransactionDate)}\n` +
            `**Total**: ${formatMoney(totalDebit)}\n\n` +
            `Voucher has been successfully created and booked.`;
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // List voucher series
  server.registerTool(
    "fortnox_list_voucher_series",
    {
      title: "List Fortnox Voucher Series",
      description: `List available voucher series in Fortnox.

Voucher series are used to categorize vouchers (e.g., 'A' for manual entries, 'B' for bank, etc.).

Args:
  - response_format ('markdown' | 'json'): Output format

Returns:
  List of voucher series with code, description, and whether manual entries are allowed.`,
      inputSchema: mcpSchema(ListVoucherSeriesSchema),
      outputSchema: mcpSchema(ListVoucherSeriesOutput),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: ListVoucherSeriesInput) => {
      try {
        const response = await fortnoxRequest<VoucherSeriesListResponse>("/3/voucherseries");
        const series = response.VoucherSeriesCollection || [];

        const output = {
          count: series.length,
          series: series.map((s) => ({
            code: s.Code,
            description: s.Description,
            manual: s.Manual ?? false
          }))
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          const lines = [
            "# Voucher Series",
            "",
            "| Code | Description | Manual |",
            "|------|-------------|--------|"
          ];

          for (const s of series) {
            lines.push(`| ${s.Code} | ${s.Description} | ${s.Manual ? "Yes" : "No"} |`);
          }

          textContent = lines.join("\n");
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Account Activity Tool - Filter vouchers by account number
  server.registerTool(
    "fortnox_account_activity",
    {
      title: "Account Activity Report",
      description: `Voucher transactions touching one or more accounts, with per-account totals. Needs account_number, account_numbers or account_range. financial_year is Fortnox's sequential ID (1, 2, 3...), not a calendar year - call fortnox_list_financial_years first.`,
      inputSchema: mcpSchema(AccountActivitySchema),
      outputSchema: mcpSchema(AccountActivityOutput),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: AccountActivityInput) => {
      try {
        // Build account filter set
        const accountFilter = new Set<number>();
        if (params.account_number !== undefined) {
          accountFilter.add(params.account_number);
        }
        if (params.account_numbers) {
          params.account_numbers.forEach((n) => accountFilter.add(n));
        }
        let accountRangeFrom: number | undefined;
        let accountRangeTo: number | undefined;
        if (params.account_range) {
          accountRangeFrom = params.account_range.from;
          accountRangeTo = params.account_range.to;
        }

        // Build query params
        const queryParams: Record<string, string | number | boolean | undefined> = {
          financialyear: params.financial_year
        };

        // Handle period convenience filter
        let dateRangeDescription: string | undefined;
        if (params.period) {
          const dateRange = periodToDateRange(params.period);
          queryParams.fromdate = dateRange.from_date;
          queryParams.todate = dateRange.to_date;
          dateRangeDescription = getPeriodDescription(params.period);
        } else {
          if (params.from_date) queryParams.fromdate = params.from_date;
          if (params.to_date) queryParams.todate = params.to_date;
          if (params.from_date || params.to_date) {
            dateRangeDescription = `${params.from_date || "start"} to ${params.to_date || "end"}`;
          }
        }

        // Determine endpoint based on series filter
        let endpoint = "/3/vouchers";
        if (params.voucher_series) {
          endpoint = `/3/vouchers/sublist/${encodeURIComponent(params.voucher_series)}`;
        }

        // Fetch voucher list
        const result = await fetchAllPages<FortnoxVoucherListItem, VoucherListResponse>(
          endpoint,
          queryParams,
          (r) => r.Vouchers || [],
          (r) => r.MetaInformation?.["@TotalResources"] || 0,
          {
            maxResults: params.max_vouchers ?? 500,
            maxPages: Math.ceil((params.max_vouchers ?? 500) / 100)
          }
        );

        const voucherList = result.items;
        const totalVouchers = result.total;

        // Helper to check if account matches filter
        const accountMatches = (account: number): boolean => {
          if (accountFilter.has(account)) return true;
          if (accountRangeFrom !== undefined && accountRangeTo !== undefined) {
            return account >= accountRangeFrom && account <= accountRangeTo;
          }
          return false;
        };

        // Batch fetch voucher details with rate limiting
        const matchingTransactions: Array<{
          voucher_series: string;
          voucher_number: number;
          transaction_date: string;
          voucher_description: string;
          account: number;
          description: string | null;
          debit: number;
          credit: number;
        }> = [];

        const accountSummary = new Map<number, { debit: number; credit: number; count: number }>();

        // Process vouchers in batches of 10
        const batchSize = 10;
        for (let i = 0; i < voucherList.length; i += batchSize) {
          const batch = voucherList.slice(i, i + batchSize);

          // Fetch details for batch in parallel
          const detailPromises = batch.map(async (v) => {
            const detailEndpoint = `/3/vouchers/${encodeURIComponent(v.VoucherSeries)}/${v.VoucherNumber}`;
            const detailParams: Record<string, string | number | boolean | undefined> = {
              financialyear: params.financial_year
            };
            try {
              const detail = await fortnoxRequest<VoucherResponse>(
                detailEndpoint,
                "GET",
                undefined,
                detailParams
              );
              return detail.Voucher;
            } catch {
              return null;
            }
          });

          const details = await Promise.all(detailPromises);

          // Process results
          for (const voucher of details) {
            if (!voucher || !voucher.VoucherRows) continue;

            for (const row of voucher.VoucherRows) {
              if (accountMatches(row.Account)) {
                matchingTransactions.push({
                  voucher_series: voucher.VoucherSeries,
                  voucher_number: voucher.VoucherNumber,
                  transaction_date: voucher.TransactionDate,
                  voucher_description: voucher.Description,
                  account: row.Account,
                  description: row.Description || null,
                  debit: row.Debit || 0,
                  credit: row.Credit || 0
                });

                // Update summary
                if (params.include_summary ?? true) {
                  const existing = accountSummary.get(row.Account) || {
                    debit: 0,
                    credit: 0,
                    count: 0
                  };
                  existing.debit += row.Debit || 0;
                  existing.credit += row.Credit || 0;
                  existing.count += 1;
                  accountSummary.set(row.Account, existing);
                }
              }
            }
          }

          // Rate limit delay between batches (except last batch)
          if (i + batchSize < voucherList.length) {
            await new Promise((resolve) => setTimeout(resolve, FETCH_ALL_DELAY_MS));
          }
        }

        // Sort transactions by date descending
        matchingTransactions.sort(
          (a, b) =>
            b.transaction_date.localeCompare(a.transaction_date) ||
            b.voucher_number - a.voucher_number
        );

        // Build output
        const summaryArray =
          (params.include_summary ?? true)
            ? Array.from(accountSummary.entries())
                .map(([account, data]) => ({
                  account,
                  total_debit: data.debit,
                  total_credit: data.credit,
                  net_change: data.credit - data.debit,
                  transaction_count: data.count
                }))
                .sort((a, b) => a.account - b.account)
            : undefined;

        const output: Record<string, unknown> = {
          filter: {
            accounts: Array.from(accountFilter),
            account_range: params.account_range || null,
            financial_year: params.financial_year,
            date_range: dateRangeDescription || null,
            voucher_series: params.voucher_series || null
          },
          vouchers_scanned: voucherList.length,
          total_vouchers_available: totalVouchers,
          truncated: result.truncated,
          truncation_reason: result.truncationReason,
          matching_transactions: matchingTransactions.length,
          summary: summaryArray,
          transactions: matchingTransactions
        };

        // Format output
        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          const accountDesc = params.account_number
            ? `Account ${params.account_number}`
            : params.account_range
              ? `Accounts ${params.account_range.from}-${params.account_range.to}`
              : `Accounts ${Array.from(accountFilter).join(", ")}`;

          const lines: string[] = [`# Account Activity: ${accountDesc}`, ""];

          if (dateRangeDescription) {
            lines.push(`**Period**: ${dateRangeDescription}`);
          }
          lines.push(`**Financial Year**: ${params.financial_year}`);
          lines.push(
            `**Vouchers Scanned**: ${voucherList.length} | **Matching Transactions**: ${matchingTransactions.length}`
          );

          if (result.truncated) {
            lines.push("");
            lines.push(`⚠️ **Note**: ${result.truncationReason}`);
          }

          if (summaryArray && summaryArray.length > 0) {
            lines.push("");
            lines.push("## Summary");
            lines.push("");
            lines.push("| Account | Total Debit | Total Credit | Net Change | Transactions |");
            lines.push("|---------|-------------|--------------|------------|--------------|");

            for (const s of summaryArray) {
              lines.push(
                `| ${s.account} | ${formatMoney(s.total_debit)} | ${formatMoney(s.total_credit)} | ${formatMoney(s.net_change)} | ${s.transaction_count} |`
              );
            }
          }

          if (matchingTransactions.length > 0) {
            lines.push("");
            lines.push("## Transactions");
            lines.push("");
            lines.push("| Date | Voucher | Account | Description | Debit | Credit |");
            lines.push("|------|---------|---------|-------------|-------|--------|");

            const displayLimit = 100;
            const displayTransactions = matchingTransactions.slice(0, displayLimit);

            for (const t of displayTransactions) {
              lines.push(
                `| ${formatDisplayDate(t.transaction_date)} | ${t.voucher_series}${t.voucher_number} | ${t.account} | ${t.description || t.voucher_description} | ${formatMoney(t.debit)} | ${formatMoney(t.credit)} |`
              );
            }

            if (matchingTransactions.length > displayLimit) {
              lines.push(
                `| ... | ... | ... | *${matchingTransactions.length - displayLimit} more transactions* | ... | ... |`
              );
            }
          } else {
            lines.push("");
            lines.push("*No transactions found matching the account criteria.*");
          }

          textContent = lines.join("\n");
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Search Vouchers Tool - Text search in voucher descriptions
  server.registerTool(
    "fortnox_search_vouchers",
    {
      title: "Search Vouchers",
      description: `Search voucher descriptions for text, optionally limited by series, financial year or dates. include_rows adds the accounting rows.`,
      inputSchema: mcpSchema(SearchVouchersSchema),
      outputSchema: mcpSchema(SearchVouchersOutput),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: SearchVouchersInput) => {
      try {
        // Build query params
        const queryParams: Record<string, string | number | boolean | undefined> = {
          financialyear: params.financial_year
        };

        // Handle period convenience filter
        let dateRangeDescription: string | undefined;
        if (params.period) {
          const dateRange = periodToDateRange(params.period);
          queryParams.fromdate = dateRange.from_date;
          queryParams.todate = dateRange.to_date;
          dateRangeDescription = getPeriodDescription(params.period);
        } else {
          if (params.from_date) queryParams.fromdate = params.from_date;
          if (params.to_date) queryParams.todate = params.to_date;
          if (params.from_date || params.to_date) {
            dateRangeDescription = `${params.from_date || "start"} to ${params.to_date || "end"}`;
          }
        }

        // Determine endpoint based on series filter
        let endpoint = "/3/vouchers";
        if (params.voucher_series) {
          endpoint = `/3/vouchers/sublist/${encodeURIComponent(params.voucher_series)}`;
        }

        // Fetch voucher list
        const result = await fetchAllPages<FortnoxVoucherListItem, VoucherListResponse>(
          endpoint,
          queryParams,
          (r) => r.Vouchers || [],
          (r) => r.MetaInformation?.["@TotalResources"] || 0,
          {
            maxResults: params.max_vouchers ?? 500,
            maxPages: Math.ceil((params.max_vouchers ?? 500) / 100)
          }
        );

        const voucherList = result.items;
        const totalVouchers = result.total;

        // Prepare search
        const searchText =
          (params.case_sensitive ?? false) ? params.search_text : params.search_text.toLowerCase();

        const textMatches = (text: string | undefined): boolean => {
          if (!text) return false;
          const compareText = params.case_sensitive ? text : text.toLowerCase();
          return compareText.includes(searchText);
        };

        // First pass: filter by description in list
        const candidateVouchers = voucherList.filter((v) => textMatches(v.Description));

        // If include_rows is true, we need to fetch details and also check row descriptions
        interface MatchingVoucher {
          voucher_series: string;
          voucher_number: number;
          transaction_date: string;
          description: string;
          matched_in: "description" | "row";
          rows?:
            | Array<{
                account: number;
                description: string | null;
                debit: number;
                credit: number;
              }>
            | undefined;
        }

        const matchingVouchers: MatchingVoucher[] = [];

        if (params.include_rows ?? false) {
          // Fetch details for all vouchers (to check row descriptions too)
          const batchSize = 10;
          for (let i = 0; i < voucherList.length; i += batchSize) {
            const batch = voucherList.slice(i, i + batchSize);

            const detailPromises = batch.map(async (v) => {
              const detailEndpoint = `/3/vouchers/${encodeURIComponent(v.VoucherSeries)}/${v.VoucherNumber}`;
              const detailParams: Record<string, string | number | boolean | undefined> = {
                financialyear: params.financial_year
              };
              try {
                const detail = await fortnoxRequest<VoucherResponse>(
                  detailEndpoint,
                  "GET",
                  undefined,
                  detailParams
                );
                return detail.Voucher;
              } catch {
                return null;
              }
            });

            const details = await Promise.all(detailPromises);

            for (const voucher of details) {
              if (!voucher) continue;

              const descriptionMatch = textMatches(voucher.Description);
              const rowMatch = voucher.VoucherRows?.some((row) => textMatches(row.Description));

              if (descriptionMatch || rowMatch) {
                matchingVouchers.push({
                  voucher_series: voucher.VoucherSeries,
                  voucher_number: voucher.VoucherNumber,
                  transaction_date: voucher.TransactionDate,
                  description: voucher.Description,
                  matched_in: descriptionMatch ? "description" : "row",
                  rows: voucher.VoucherRows?.map((row) => ({
                    account: row.Account,
                    description: row.Description || null,
                    debit: row.Debit || 0,
                    credit: row.Credit || 0
                  }))
                });
              }
            }

            // Rate limit delay between batches
            if (i + batchSize < voucherList.length) {
              await new Promise((resolve) => setTimeout(resolve, FETCH_ALL_DELAY_MS));
            }
          }
        } else {
          // Just use the list descriptions
          for (const v of candidateVouchers) {
            matchingVouchers.push({
              voucher_series: v.VoucherSeries,
              voucher_number: v.VoucherNumber,
              transaction_date: v.TransactionDate,
              description: v.Description,
              matched_in: "description"
            });
          }
        }

        // Sort by date descending
        matchingVouchers.sort(
          (a, b) =>
            b.transaction_date.localeCompare(a.transaction_date) ||
            b.voucher_number - a.voucher_number
        );

        // Build output
        const output: Record<string, unknown> = {
          search_text: params.search_text,
          case_sensitive: params.case_sensitive,
          financial_year: params.financial_year,
          date_range: dateRangeDescription || null,
          voucher_series: params.voucher_series || null,
          vouchers_scanned: voucherList.length,
          total_vouchers_available: totalVouchers,
          truncated: result.truncated,
          truncation_reason: result.truncationReason,
          matching_count: matchingVouchers.length,
          vouchers: matchingVouchers
        };

        // Format output
        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          const lines: string[] = [`# Voucher Search: "${params.search_text}"`, ""];

          if (dateRangeDescription) {
            lines.push(`**Period**: ${dateRangeDescription}`);
          }
          lines.push(`**Financial Year**: ${params.financial_year}`);
          lines.push(
            `**Vouchers Scanned**: ${voucherList.length} | **Matches**: ${matchingVouchers.length}`
          );

          if (result.truncated) {
            lines.push("");
            lines.push(`⚠️ **Note**: ${result.truncationReason}`);
          }

          if (matchingVouchers.length > 0) {
            lines.push("");
            lines.push("## Results");
            lines.push("");

            const displayLimit = 50;
            const displayVouchers = matchingVouchers.slice(0, displayLimit);

            for (const v of displayVouchers) {
              lines.push(
                `### ${v.voucher_series}${v.voucher_number} (${formatDisplayDate(v.transaction_date)})`
              );
              lines.push(`**Description**: ${v.description}`);

              if (v.rows && v.rows.length > 0) {
                lines.push("");
                lines.push("| Account | Description | Debit | Credit |");
                lines.push("|---------|-------------|-------|--------|");
                for (const row of v.rows) {
                  const rowDesc = row.description || "-";
                  const highlight = textMatches(row.description || "") ? " **" : "";
                  lines.push(
                    `| ${row.account} | ${highlight}${rowDesc}${highlight} | ${formatMoney(row.debit)} | ${formatMoney(row.credit)} |`
                  );
                }
              }
              lines.push("");
            }

            if (matchingVouchers.length > displayLimit) {
              lines.push(`*... and ${matchingVouchers.length - displayLimit} more matches*`);
            }
          } else {
            lines.push("");
            lines.push(`*No vouchers found matching "${params.search_text}"*`);
          }

          textContent = lines.join("\n");
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );
}
