import { McpServer } from "@modelcontextprotocol/server";
import { fortnoxRequest } from "../services/api.js";
import { ResponseFormat, DEFAULT_PAGE_SIZE } from "../constants.js";
import { mcpSchema } from "../services/mcpSchema.js";
import {
  buildToolResponse,
  buildErrorResponse,
  formatBoolean,
  formatListMarkdown,
  formatDetailMarkdown,
  buildPaginationMeta
} from "../services/formatters.js";
import {
  ListAccountsSchema,
  GetAccountSchema,
  CreateAccountSchema,
  UpdateAccountSchema,
  DeleteAccountSchema,
  type ListAccountsInput,
  type GetAccountInput,
  type CreateAccountInput,
  type UpdateAccountInput,
  type DeleteAccountInput,
  ListAccountsOutput,
  AccountDetailSchema,
  AccountMutationOutput,
  DeleteAccountOutput
} from "../schemas/accounts.js";

// API response types
interface FortnoxAccount {
  Number: number;
  Description: string;
  Active?: boolean;
  VATCode?: string;
  BalanceBroughtForward?: number;
  BalanceCarriedForward?: number;
  CostCenterSettings?: string;
  ProjectSettings?: string;
  SRU?: number;
  Year?: number;
  "@url"?: string;
}

interface FortnoxAccountListItem {
  Number: number;
  Description: string;
  Active?: boolean;
  "@url"?: string;
}

interface AccountListResponse {
  Accounts: FortnoxAccountListItem[];
  MetaInformation?: {
    "@TotalResources": number;
    "@TotalPages": number;
    "@CurrentPage": number;
  };
}

interface AccountResponse {
  Account: FortnoxAccount;
}

/**
 * Register all account-related tools
 */
export function registerAccountTools(server: McpServer): void {
  // List accounts
  server.registerTool(
    "fortnox_list_accounts",
    {
      title: "List Fortnox Accounts",
      description: `Chart of accounts, filterable by description or an account-number range.`,
      inputSchema: mcpSchema(ListAccountsSchema),
      outputSchema: mcpSchema(ListAccountsOutput),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: ListAccountsInput) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {
          limit: params.limit ?? DEFAULT_PAGE_SIZE,
          page: params.page ?? 1
        };

        if (params.search_description) queryParams.description = params.search_description;
        if (params.from_account) queryParams.fromaccount = params.from_account;
        if (params.to_account) queryParams.toaccount = params.to_account;

        const response = await fortnoxRequest<AccountListResponse>(
          "/3/accounts",
          "GET",
          undefined,
          queryParams
        );
        const accounts = response.Accounts || [];
        const total = response.MetaInformation?.["@TotalResources"] || accounts.length;

        const output = {
          ...buildPaginationMeta(
            total,
            params.page ?? 1,
            params.limit ?? DEFAULT_PAGE_SIZE,
            accounts.length
          ),
          accounts: accounts.map((a) => ({
            account_number: a.Number,
            description: a.Description,
            active: a.Active ?? true
          }))
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = formatListMarkdown(
            "Chart of Accounts",
            accounts,
            total,
            params.page ?? 1,
            params.limit ?? DEFAULT_PAGE_SIZE,
            (a) => `- **${a.Number}**: ${a.Description}${a.Active === false ? " *(inactive)*" : ""}`
          );
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Get single account
  server.registerTool(
    "fortnox_get_account",
    {
      title: "Get Fortnox Account",
      description: `Retrieve detailed information about a specific account.

Args:
  - account_number (number): The account number to retrieve (1000-9999, required)
  - response_format ('markdown' | 'json'): Output format

Returns:
  Complete account details including description, VAT settings, and balances.`,
      inputSchema: mcpSchema(GetAccountSchema),
      outputSchema: mcpSchema(AccountDetailSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: GetAccountInput) => {
      try {
        const response = await fortnoxRequest<AccountResponse>(
          `/3/accounts/${params.account_number}`
        );
        const account = response.Account;

        const output = {
          account_number: account.Number,
          description: account.Description,
          active: account.Active ?? true,
          vat_code: account.VATCode || null,
          balance_brought_forward: account.BalanceBroughtForward || 0,
          balance_carried_forward: account.BalanceCarriedForward || 0,
          cost_center_settings: account.CostCenterSettings || null,
          project_settings: account.ProjectSettings || null,
          sru_code: account.SRU || null,
          year: account.Year || null
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent = formatDetailMarkdown(`Account ${account.Number}`, [
            { label: "Account Number", value: account.Number },
            { label: "Description", value: account.Description },
            { label: "Active", value: account.Active },
            { label: "VAT Code", value: account.VATCode },
            { label: "Opening Balance", value: account.BalanceBroughtForward },
            { label: "Closing Balance", value: account.BalanceCarriedForward },
            { label: "Cost Center", value: account.CostCenterSettings },
            { label: "Project", value: account.ProjectSettings },
            { label: "SRU Code", value: account.SRU }
          ]);
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Create account
  server.registerTool(
    "fortnox_create_account",
    {
      title: "Create Fortnox Account",
      description: `Create an account in the chart of accounts. Account numbers are 1000-9999 and a description is required; fails if the number already exists.`,
      inputSchema: mcpSchema(CreateAccountSchema),
      outputSchema: mcpSchema(AccountMutationOutput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: CreateAccountInput) => {
      try {
        const accountData: Record<string, unknown> = {
          Number: params.account_number,
          Description: params.description
        };

        if (params.vat_code) accountData.VATCode = params.vat_code;
        accountData.Active = params.active ?? true;
        if (params.cost_center_settings)
          accountData.CostCenterSettings = params.cost_center_settings;
        if (params.project_settings) accountData.ProjectSettings = params.project_settings;
        if (params.sru_code !== undefined) accountData.SRU = params.sru_code;

        const response = await fortnoxRequest<AccountResponse>("/3/accounts", "POST", {
          Account: accountData
        });
        const account = response.Account;

        const output = {
          success: true,
          message: `Account ${account.Number} created successfully`,
          account_number: account.Number,
          description: account.Description
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent =
            `# Account Created\n\n` +
            `**Account Number**: ${account.Number}\n` +
            `**Description**: ${account.Description}\n\n` +
            `Account has been successfully created.`;
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Update account
  server.registerTool(
    "fortnox_update_account",
    {
      title: "Update Fortnox Account",
      description: `Update an account's description, VAT code, active flag, cost-centre/project settings or SRU code.`,
      inputSchema: mcpSchema(UpdateAccountSchema),
      outputSchema: mcpSchema(AccountMutationOutput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: UpdateAccountInput) => {
      try {
        const accountData: Record<string, unknown> = {};

        if (params.description) accountData.Description = params.description;
        if (params.vat_code) accountData.VATCode = params.vat_code;
        if (params.active !== undefined) accountData.Active = params.active;
        if (params.cost_center_settings)
          accountData.CostCenterSettings = params.cost_center_settings;
        if (params.project_settings) accountData.ProjectSettings = params.project_settings;

        const response = await fortnoxRequest<AccountResponse>(
          `/3/accounts/${params.account_number}`,
          "PUT",
          { Account: accountData }
        );
        const account = response.Account;

        const output = {
          success: true,
          message: `Account ${account.Number} updated successfully`,
          account_number: account.Number,
          description: account.Description
        };

        let textContent: string;
        if (params.response_format === ResponseFormat.JSON) {
          textContent = JSON.stringify(output, null, 2);
        } else {
          textContent =
            `# Account Updated\n\n` +
            `**Account Number**: ${account.Number}\n` +
            `**Description**: ${account.Description}\n\n` +
            `Account has been successfully updated.`;
        }

        return buildToolResponse(textContent, output);
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );

  // Delete account
  server.registerTool(
    "fortnox_delete_account",
    {
      title: "Delete Fortnox Account",
      description: `Delete an account from the chart of accounts.

WARNING: This action cannot be undone. The account must not have any transactions.

Args:
  - account_number (number): Account number to delete (required)

Returns:
  Confirmation of deletion.`,
      inputSchema: mcpSchema(DeleteAccountSchema),
      outputSchema: mcpSchema(DeleteAccountOutput),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: DeleteAccountInput) => {
      try {
        await fortnoxRequest(`/3/accounts/${params.account_number}`, "DELETE");

        const output = {
          success: true,
          message: `Account ${params.account_number} deleted successfully`
        };

        return buildToolResponse(
          `# Account Deleted\n\nAccount **${params.account_number}** has been successfully deleted.`,
          output
        );
      } catch (error) {
        return buildErrorResponse(error);
      }
    }
  );
}
