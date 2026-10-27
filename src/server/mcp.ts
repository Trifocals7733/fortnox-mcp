import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCustomerTools } from "../tools/customers.js";
import { registerInvoiceTools } from "../tools/invoices.js";
import { registerSupplierTools } from "../tools/suppliers.js";
import { registerSupplierInvoiceTools } from "../tools/supplierInvoices.js";
import { registerAccountTools } from "../tools/accounts.js";
import { registerVoucherTools } from "../tools/vouchers.js";
import { registerCompanyTools } from "../tools/company.js";
import { registerAnalyticsTools } from "../tools/analytics.js";
import { registerOrderTools } from "../tools/orders.js";
import { registerBIAnalyticsTools } from "../tools/biAnalytics.js";

/**
 * The one place tools are registered. Every transport (stdio, local HTTP,
 * remote OAuth) builds its server through this, so a tool cannot end up
 * available in one mode and missing in another.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "fortnox-mcp-server",
    version: "1.0.0"
  });

  registerCustomerTools(server);
  registerInvoiceTools(server);
  registerSupplierTools(server);
  registerSupplierInvoiceTools(server);
  registerAccountTools(server);
  registerVoucherTools(server);
  registerCompanyTools(server);
  registerAnalyticsTools(server);
  registerOrderTools(server);
  registerBIAnalyticsTools(server);

  return server;
}
