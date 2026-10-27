import { McpServer } from "@modelcontextprotocol/server";
import { fortnoxRequest, fetchAllPages } from "../services/api.js";
import { ResponseFormat, DEFAULT_PAGE_SIZE, FORTNOX_PATHS } from "../constants.js";
import { mcpSchema } from "../services/mcpSchema.js";
import {
  buildToolResponse,
  buildErrorResponse,
  formatMoney,
  formatDisplayDate,
  formatBoolean,
  formatListMarkdown,
  formatDetailMarkdown,
  buildPaginationMeta
} from "../services/formatters.js";
import { periodToDateRange, getPeriodDescription } from "../services/dateHelpers.js";
import {
  ListInvoicesSchema,
  GetInvoiceSchema,
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  InvoiceActionSchema,
  SendInvoiceEmailSchema,
  type ListInvoicesInput,
  type GetInvoiceInput,
  type CreateInvoiceInput,
  type UpdateInvoiceInput,
  type InvoiceActionInput,
  type SendInvoiceEmailInput,
  ListInvoicesOutput,
  InvoiceDetailSchema,
  CreateInvoiceOutput,
  UpdateInvoiceOutput,
  BookkeepInvoiceOutput,
  CancelInvoiceOutput,
  CreditInvoiceOutput,
  SendInvoiceEmailOutput
} from "../schemas/invoices.js";

// API response types
interface FortnoxInvoiceRow {
  ArticleNumber?: string;
  Description?: string;
  DeliveredQuantity?: number | string;
  Unit?: string;
  Price?: number;
  Discount?: number;
  Total?: number;
  VAT?: number;
  AccountNumber?: number;
}

interface FortnoxInvoice {
  DocumentNumber: string;
  CustomerNumber: string;
  CustomerName?: string;
  InvoiceDate?: string;
  DueDate?: string;
  Total?: number;
  Balance?: number;
  Currency?: string;
  Booked?: boolean;
  Cancelled?: boolean;
  Sent?: boolean;
  OCR?: string;
  OurReference?: string;
  YourReference?: string;
  Comments?: string;
  Remarks?: string;
  InvoiceRows?: FortnoxInvoiceRow[];
  "@url"?: string;
}

interface FortnoxInvoiceListItem {
  DocumentNumber: string;
  CustomerNumber: string;
  CustomerName?: string;
  InvoiceDate?: string;
  DueDate?: string;
  Total?: number;
  Balance?: number;
  Currency?: string;
  Booked?: boolean;
  Cancelled?: boolean;
  "@url"?: string;
}

interface InvoiceListResponse {
  Invoices: FortnoxInvoiceListItem[];
  MetaInformation?: {
    "@TotalResources": number;
    "@TotalPages": number;
    "@CurrentPage": number;
  };
}

interface InvoiceResponse {
  Invoice: FortnoxInvoice;
}

/**
 * Register all invoice-related tools
 */
export function registerInvoiceTools(server: McpServer): void {
  // List invoices
  server.registerTool(
    "fortnox_list_invoices",
    {
      title: "List Fortnox Invoices",
      description: `Invoices, filterable by status, customer, date/period, due date and amount. fetch_all auto-paginates up to 10,000; min_amount/max_amount filter client-side after fetching.`,
      inputSchema: mcpSchema(ListInvoicesSchema),
      outputSchema: mcpSchema(ListInvoicesOutput),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: ListInvoicesInput) => {
      try {
        // Build query params
        const queryParams: Record<string, string | number | boolean | undefined> = {};

        if (params.filter) queryParams.filter = params.filter;
        if (params.customer_number) queryParams.customernumber = params.customer_number;

        // Handle period convenience filter (overrides explicit dates)
        if (params.period) {
          const dateRange = periodToDateRange(params.period);
          queryParams.fromdate = dateRange.from_date;
          queryParams.todate = dateRange.to_date;
        } else {
          if (params.from_date) queryParams.fromdate = params.from_date;
          if (params.to_date) queryParams.todate = params.to_date;
        }

        if (params.from_final_pay_date) queryParams.fromfinalpaydate = params.from_final_pay_date;
        if (params.to_final_pay_date) queryParams.tofinalpaydate = params.to_final_pay_date;

        // Handle sorting
        if (params.sortby) queryParams.sortby = params.sortby;
        if (params.sortorder) queryParams.sortorder = params.sortorder;

        let invoices: FortnoxInvoiceListItem[];
        let total: number;
        let pagesFetched = 1;
        let truncated = false;
        let truncationReason: string | undefined;

        if (params.fetch_all) {
          // Use fetchAllPages for complete dataset
          const result = await fetchAllPages<FortnoxInvoiceListItem, InvoiceListResponse>(
            FORTNOX_PATHS.invoices,
            queryParams,
            (r) => r.Invoices || [],
            (r) => r.MetaInformation?.["@TotalResources"] || 0
          );
          invoices = result.items;
          total = result.total;
          pagesFetched = result.pagesFetched;
          truncated = result.truncated;
          truncationReason = result.truncationReason;
        } else {
          // Single page request
          queryParams.limit = params.limit ?? DEFAULT_PAGE_SIZE;
          queryParams.page = params.page ?? 1;

          const response = await fortnoxRequest<InvoiceListResponse>(FORTNOX_PATHS.invoices, "GET", undefined, queryParams);
          invoices = response.Invoices || [];
          total = response.MetaInformation?.["@TotalResources"] || invoices.length;
        }

        // Apply client-side amount filters
        if (params.min_amount !== undefined) {
          invoices = invoices.filter(inv => (inv.Total || 0) >= params.min_amount!);
        }
        if (params.max_amount !== undefined) {
          invoices = invoices.filter(inv => (inv.Total || 0) <= params.max_amount!);
        }

        // Build pagination metadata
        const paginationMeta = params.fetch_all
          ? {
              total,
              count: invoices.length,
              fetched_all: true,
              pages_fetched: pagesFetched,
              truncated,
              truncation_reason: truncationReason
            }
          : {
              ...buildPaginationMeta(total, params.page ?? 1, params.limit ?? DEFAULT_PAGE_SIZE, invoices.length),
              next_offset: (params.page ?? 1) * (params.limit ?? DEFAULT_PAGE_SIZE) < total ? (params.page ?? 1) * (params.limit ?? DEFAULT_PAGE_SIZE) : undefined
            };

        const output = {
          ...paginationMeta,
          period_description: params.period ? getPeriodDescription(params.period) : undefined,
          invoices: invoices.map((inv) => ({
            document_number: inv.DocumentNumber,
            customer_number: inv.CustomerNumber,
            customer_name: inv.CustomerName || null,
            invoice_date: inv.InvoiceDate || null,
            due_date: inv.DueDate || null,
            total: inv.Total || 0,
            balance: inv.Balance || 0,
            currency: inv.Currency || "SEK",
            booked: inv.Booked ?? false,
            cancelled: inv.Cancelled ?? false
          }))
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          const title = params.period
            ? `Invoices - ${getPeriodDescription(params.period)}`
            : "Invoices";

          if (params.fetch_all) {
            // Custom formatting for fetch_all mode
            const lines: string[] = [
              `# ${title}`,
              "",
              `Showing ${invoices.length} of ${total} total invoices`,
              `(${pagesFetched} pages fetched)`
            ];

            if (truncated) {
              lines.push("");
              lines.push(`⚠️ **Results truncated**: ${truncationReason}`);
            }

            lines.push("");

            for (const inv of invoices) {
              const status = inv.Cancelled ? "CANCELLED" :
                (inv.Balance === 0 ? "PAID" :
                  (inv.Booked ? "BOOKED" : "DRAFT"));
              lines.push(`## Invoice #${inv.DocumentNumber}`);
              lines.push(`- **Customer**: ${inv.CustomerName || inv.CustomerNumber}`);
              lines.push(`- **Date**: ${formatDisplayDate(inv.InvoiceDate)} | **Due**: ${formatDisplayDate(inv.DueDate)}`);
              lines.push(`- **Total**: ${formatMoney(inv.Total, inv.Currency)} | **Balance**: ${formatMoney(inv.Balance, inv.Currency)}`);
              lines.push(`- **Status**: ${status}`);
              lines.push("");
            }

            textContent = lines.join("\n");
          } else {
            textContent = formatListMarkdown(
              title,
              invoices,
              total,
              params.page ?? 1,
              params.limit ?? DEFAULT_PAGE_SIZE,
              (inv) => {
                const status = inv.Cancelled ? "CANCELLED" :
                  (inv.Balance === 0 ? "PAID" :
                    (inv.Booked ? "BOOKED" : "DRAFT"));
                return `## Invoice #${inv.DocumentNumber}\n` +
                  `- **Customer**: ${inv.CustomerName || inv.CustomerNumber}\n` +
                  `- **Date**: ${formatDisplayDate(inv.InvoiceDate)} | **Due**: ${formatDisplayDate(inv.DueDate)}\n` +
                  `- **Total**: ${formatMoney(inv.Total, inv.Currency)} | **Balance**: ${formatMoney(inv.Balance, inv.Currency)}\n` +
                  `- **Status**: ${status}`;
              }
            );
          }
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Get single invoice
  server.registerTool(
    "fortnox_get_invoice",
    {
      title: "Get Fortnox Invoice",
      description: `Retrieve detailed information about a specific invoice including all line items.

Args:
  - document_number (string): The invoice document number to retrieve (required)
  - response_format ('markdown' | 'json'): Output format

Returns:
  Complete invoice details including customer info, dates, amounts, line items, and payment status.`,
      inputSchema: mcpSchema(GetInvoiceSchema),
      outputSchema: mcpSchema(InvoiceDetailSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: GetInvoiceInput) => {
      try {
        const response = await fortnoxRequest<InvoiceResponse>(
          `${FORTNOX_PATHS.invoices}/${encodeURIComponent(params.document_number)}`
        );
        const invoice = response.Invoice;

        const output = {
          document_number: invoice.DocumentNumber,
          customer_number: invoice.CustomerNumber,
          customer_name: invoice.CustomerName || null,
          invoice_date: invoice.InvoiceDate || null,
          due_date: invoice.DueDate || null,
          total: invoice.Total || 0,
          balance: invoice.Balance || 0,
          currency: invoice.Currency || "SEK",
          ocr: invoice.OCR || null,
          our_reference: invoice.OurReference || null,
          your_reference: invoice.YourReference || null,
          booked: invoice.Booked ?? false,
          cancelled: invoice.Cancelled ?? false,
          sent: invoice.Sent ?? false,
          comments: invoice.Comments || null,
          remarks: invoice.Remarks || null,
          rows: (invoice.InvoiceRows || []).map((row) => ({
            article_number: row.ArticleNumber || null,
            description: row.Description || null,
            // Fortnox returns DeliveredQuantity as a string ("2"), unlike the other row numbers
            quantity: Number(row.DeliveredQuantity ?? 0) || 0,
            unit: row.Unit || null,
            price: row.Price || 0,
            discount: row.Discount || 0,
            total: row.Total || 0,
            vat: row.VAT || 0,
            account_number: row.AccountNumber || null
          }))
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          const status = invoice.Cancelled ? "CANCELLED" :
            (invoice.Balance === 0 ? "PAID" :
              (invoice.Booked ? "BOOKED" : "DRAFT"));

          const lines = [
            `# Invoice #${invoice.DocumentNumber}`,
            "",
            `**Status**: ${status}`,
            "",
            "## Customer",
            `- **Number**: ${invoice.CustomerNumber}`,
            `- **Name**: ${invoice.CustomerName || "-"}`,
            "",
            "## Dates & Payment",
            `- **Invoice Date**: ${formatDisplayDate(invoice.InvoiceDate)}`,
            `- **Due Date**: ${formatDisplayDate(invoice.DueDate)}`,
            `- **OCR**: ${invoice.OCR || "-"}`,
            "",
            "## Amounts",
            `- **Total**: ${formatMoney(invoice.Total, invoice.Currency)}`,
            `- **Balance**: ${formatMoney(invoice.Balance, invoice.Currency)}`,
            ""
          ];

          if (invoice.InvoiceRows && invoice.InvoiceRows.length > 0) {
            lines.push("## Line Items", "");
            lines.push("| Description | Qty | Price | Total |");
            lines.push("|-------------|-----|-------|-------|");
            for (const row of invoice.InvoiceRows) {
              lines.push(
                `| ${row.Description || row.ArticleNumber || "-"} | ${row.DeliveredQuantity || 1} | ${formatMoney(row.Price)} | ${formatMoney(row.Total)} |`
              );
            }
          }

          if (invoice.Remarks) {
            lines.push("", "## Remarks", invoice.Remarks);
          }
          if (invoice.Comments) {
            lines.push("", "## Comments", invoice.Comments);
          }

          textContent = lines.join("\n");
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Create invoice
  server.registerTool(
    "fortnox_create_invoice",
    {
      title: "Create Fortnox Invoice",
      description: `Create an invoice as a draft with at least one row. Bookkeep it afterwards with fortnox_bookkeep_invoice to post it. The customer number must exist.`,
      inputSchema: mcpSchema(CreateInvoiceSchema),
      outputSchema: mcpSchema(CreateInvoiceOutput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: CreateInvoiceInput) => {
      try {
        const invoiceData: Record<string, unknown> = {
          CustomerNumber: params.customer_number,
          InvoiceRows: params.rows.map((row) => {
            const invoiceRow: Record<string, unknown> = {};
            if (row.article_number) invoiceRow.ArticleNumber = row.article_number;
            if (row.description) invoiceRow.Description = row.description;
            if (row.quantity !== undefined) invoiceRow.DeliveredQuantity = row.quantity;
            if (row.unit) invoiceRow.Unit = row.unit;
            if (row.price !== undefined) invoiceRow.Price = row.price;
            if (row.discount !== undefined) invoiceRow.Discount = row.discount;
            if (row.account_number !== undefined) invoiceRow.AccountNumber = row.account_number;
            if (row.vat !== undefined) invoiceRow.VAT = row.vat;
            return invoiceRow;
          })
        };

        if (params.invoice_date) invoiceData.InvoiceDate = params.invoice_date;
        if (params.due_date) invoiceData.DueDate = params.due_date;
        if (params.our_reference) invoiceData.OurReference = params.our_reference;
        if (params.your_reference) invoiceData.YourReference = params.your_reference;
        if (params.invoice_type) invoiceData.InvoiceType = params.invoice_type;
        if (params.currency) invoiceData.Currency = params.currency;
        if (params.terms_of_payment) invoiceData.TermsOfPayment = params.terms_of_payment;
        if (params.comments) invoiceData.Comments = params.comments;
        if (params.remarks) invoiceData.Remarks = params.remarks;
        if (params.freight !== undefined) invoiceData.Freight = params.freight;
        if (params.administration_fee !== undefined) invoiceData.AdministrationFee = params.administration_fee;

        const response = await fortnoxRequest<InvoiceResponse>(
          FORTNOX_PATHS.invoices,
          "POST",
          { Invoice: invoiceData }
        );
        const invoice = response.Invoice;

        const output = {
          success: true,
          message: `Invoice #${invoice.DocumentNumber} created successfully`,
          document_number: invoice.DocumentNumber,
          customer_number: invoice.CustomerNumber,
          customer_name: invoice.CustomerName || null,
          total: invoice.Total || 0,
          currency: invoice.Currency || "SEK"
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = `# Invoice Created\n\n` +
            `**Document Number**: ${invoice.DocumentNumber}\n` +
            `**Customer**: ${invoice.CustomerName || invoice.CustomerNumber}\n` +
            `**Total**: ${formatMoney(invoice.Total, invoice.Currency)}\n\n` +
            `Invoice has been created as a draft. Use \`fortnox_bookkeep_invoice\` to bookkeep it.`;
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Update invoice
  server.registerTool(
    "fortnox_update_invoice",
    {
      title: "Update Fortnox Invoice",
      description: `Update an existing invoice in Fortnox. Only unbooked invoices can be updated.

Args:
  - document_number (string): Invoice document number to update (required)
  - rows (array): Updated line items (replaces all existing rows)
  - Other fields: Same as create_invoice

Returns:
  The updated invoice details.`,
      inputSchema: mcpSchema(UpdateInvoiceSchema),
      outputSchema: mcpSchema(UpdateInvoiceOutput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: UpdateInvoiceInput) => {
      try {
        const invoiceData: Record<string, unknown> = {};

        if (params.rows) {
          invoiceData.InvoiceRows = params.rows.map((row) => {
            const invoiceRow: Record<string, unknown> = {};
            if (row.article_number) invoiceRow.ArticleNumber = row.article_number;
            if (row.description) invoiceRow.Description = row.description;
            if (row.quantity !== undefined) invoiceRow.DeliveredQuantity = row.quantity;
            if (row.unit) invoiceRow.Unit = row.unit;
            if (row.price !== undefined) invoiceRow.Price = row.price;
            if (row.discount !== undefined) invoiceRow.Discount = row.discount;
            if (row.account_number !== undefined) invoiceRow.AccountNumber = row.account_number;
            if (row.vat !== undefined) invoiceRow.VAT = row.vat;
            return invoiceRow;
          });
        }

        if (params.invoice_date) invoiceData.InvoiceDate = params.invoice_date;
        if (params.due_date) invoiceData.DueDate = params.due_date;
        if (params.our_reference) invoiceData.OurReference = params.our_reference;
        if (params.your_reference) invoiceData.YourReference = params.your_reference;
        if (params.comments) invoiceData.Comments = params.comments;
        if (params.remarks) invoiceData.Remarks = params.remarks;
        if (params.freight !== undefined) invoiceData.Freight = params.freight;
        if (params.administration_fee !== undefined) invoiceData.AdministrationFee = params.administration_fee;

        const response = await fortnoxRequest<InvoiceResponse>(
          `${FORTNOX_PATHS.invoices}/${encodeURIComponent(params.document_number)}`,
          "PUT",
          { Invoice: invoiceData }
        );
        const invoice = response.Invoice;

        const output = {
          success: true,
          message: `Invoice #${invoice.DocumentNumber} updated successfully`,
          document_number: invoice.DocumentNumber,
          total: invoice.Total || 0
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = `# Invoice Updated\n\n` +
            `**Document Number**: ${invoice.DocumentNumber}\n` +
            `**Total**: ${formatMoney(invoice.Total, invoice.Currency)}\n\n` +
            `Invoice has been updated.`;
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Bookkeep invoice
  server.registerTool(
    "fortnox_bookkeep_invoice",
    {
      title: "Bookkeep Fortnox Invoice",
      description: `Bookkeep an invoice, creating the accounting entries. Once booked, the invoice cannot be edited.

Args:
  - document_number (string): Invoice document number to bookkeep (required)
  - response_format ('markdown' | 'json'): Output format

Returns:
  Confirmation of bookkeeping with the created voucher reference.`,
      inputSchema: mcpSchema(InvoiceActionSchema),
      outputSchema: mcpSchema(BookkeepInvoiceOutput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: InvoiceActionInput) => {
      try {
        const response = await fortnoxRequest<InvoiceResponse>(
          `${FORTNOX_PATHS.invoices}/${encodeURIComponent(params.document_number)}/bookkeep`,
          "PUT"
        );
        const invoice = response.Invoice;

        const output = {
          success: true,
          message: `Invoice #${invoice.DocumentNumber} has been booked`,
          document_number: invoice.DocumentNumber,
          booked: true
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = `# Invoice Booked\n\n` +
            `Invoice **#${invoice.DocumentNumber}** has been successfully booked.\n\n` +
            `Accounting entries have been created.`;
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Cancel invoice
  server.registerTool(
    "fortnox_cancel_invoice",
    {
      title: "Cancel Fortnox Invoice",
      description: `Cancel an invoice. Booked invoices will have reversal entries created.

Args:
  - document_number (string): Invoice document number to cancel (required)
  - response_format ('markdown' | 'json'): Output format

Returns:
  Confirmation of cancellation.`,
      inputSchema: mcpSchema(InvoiceActionSchema),
      outputSchema: mcpSchema(CancelInvoiceOutput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: InvoiceActionInput) => {
      try {
        const response = await fortnoxRequest<InvoiceResponse>(
          `${FORTNOX_PATHS.invoices}/${encodeURIComponent(params.document_number)}/cancel`,
          "PUT"
        );
        const invoice = response.Invoice;

        const output = {
          success: true,
          message: `Invoice #${invoice.DocumentNumber} has been cancelled`,
          document_number: invoice.DocumentNumber,
          cancelled: true
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = `# Invoice Cancelled\n\n` +
            `Invoice **#${invoice.DocumentNumber}** has been cancelled.`;
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Credit invoice
  server.registerTool(
    "fortnox_credit_invoice",
    {
      title: "Credit Fortnox Invoice",
      description: `Create a credit note for an invoice. This creates a new credit invoice referencing the original.

Args:
  - document_number (string): Invoice document number to credit (required)
  - response_format ('markdown' | 'json'): Output format

Returns:
  The created credit invoice details.`,
      inputSchema: mcpSchema(InvoiceActionSchema),
      outputSchema: mcpSchema(CreditInvoiceOutput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: InvoiceActionInput) => {
      try {
        const response = await fortnoxRequest<InvoiceResponse>(
          `${FORTNOX_PATHS.invoices}/${encodeURIComponent(params.document_number)}/credit`,
          "PUT"
        );
        const creditInvoice = response.Invoice;

        const output = {
          success: true,
          message: `Credit invoice #${creditInvoice.DocumentNumber} created for invoice #${params.document_number}`,
          original_document_number: params.document_number,
          credit_document_number: creditInvoice.DocumentNumber,
          total: creditInvoice.Total || 0
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = `# Credit Invoice Created\n\n` +
            `**Credit Invoice**: #${creditInvoice.DocumentNumber}\n` +
            `**Original Invoice**: #${params.document_number}\n` +
            `**Total**: ${formatMoney(creditInvoice.Total, creditInvoice.Currency)}`;
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Send invoice by email
  server.registerTool(
    "fortnox_send_invoice_email",
    {
      title: "Send Fortnox Invoice by Email",
      description: `Send an invoice to the customer via email.

The invoice will be sent to the email address configured for the customer.

Args:
  - document_number (string): Invoice document number to send (required)
  - response_format ('markdown' | 'json'): Output format

Returns:
  Confirmation that the email was sent.`,
      inputSchema: mcpSchema(SendInvoiceEmailSchema),
      outputSchema: mcpSchema(SendInvoiceEmailOutput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: SendInvoiceEmailInput) => {
      try {
        const response = await fortnoxRequest<InvoiceResponse>(
          `${FORTNOX_PATHS.invoices}/${encodeURIComponent(params.document_number)}/email`
        );
        const invoice = response.Invoice;

        const output = {
          success: true,
          message: `Invoice #${invoice.DocumentNumber} sent by email`,
          document_number: invoice.DocumentNumber,
          sent: true
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = `# Invoice Sent\n\n` +
            `Invoice **#${invoice.DocumentNumber}** has been sent by email to the customer.`;
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );
}
