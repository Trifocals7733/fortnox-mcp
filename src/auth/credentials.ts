/**
 * Fortnox OAuth Credentials
 *
 * These can be:
 * 1. Embedded at build time (for simplified user experience)
 * 2. Provided via environment variables (for flexibility)
 *
 * The embedded credentials are YOUR app's credentials, allowing users
 * to authorize your app without creating their own Fortnox developer account.
 */

// Embedded credentials (set via build-time env vars or replace directly)
// These are intentionally left as placeholders - replace with your actual credentials
// or set via FORTNOX_CLIENT_ID and FORTNOX_CLIENT_SECRET env vars
const EMBEDDED_CLIENT_ID = process.env.FORTNOX_CLIENT_ID || "";
const EMBEDDED_CLIENT_SECRET = process.env.FORTNOX_CLIENT_SECRET || "";

export interface FortnoxCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Get Fortnox OAuth credentials
 * Prefers embedded credentials, falls back to environment variables
 */
export function getFortnoxCredentials(): FortnoxCredentials {
  const clientId = EMBEDDED_CLIENT_ID || process.env.FORTNOX_CLIENT_ID;
  const clientSecret = EMBEDDED_CLIENT_SECRET || process.env.FORTNOX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing Fortnox credentials. Set FORTNOX_CLIENT_ID and FORTNOX_CLIENT_SECRET environment variables."
    );
  }

  return { clientId, clientSecret };
}

/**
 * Check if credentials are available
 */
export function hasFortnoxCredentials(): boolean {
  const clientId = EMBEDDED_CLIENT_ID || process.env.FORTNOX_CLIENT_ID;
  const clientSecret = EMBEDDED_CLIENT_SECRET || process.env.FORTNOX_CLIENT_SECRET;
  return !!(clientId && clientSecret);
}

/**
 * Fortnox OAuth scopes required by this MCP server
 */
/**
 * Fortnox OAuth scopes required by this MCP server.
 *
 * One scope per API area the tools actually call. A missing scope is not a
 * startup error — Fortnox answers the call with 400 "Har inte behörighet för
 * scope", so the tool looks broken rather than unauthorised.
 *
 * Licences are gated per scope on the customer's Fortnox subscription: asking
 * for `order`/`offer` from a company without the Order module makes the whole
 * authorization fail, so drop those two if that is a problem.
 */
export const FORTNOX_SCOPES = [
  "companyinformation",
  "customer",
  "invoice",
  "supplier",
  "supplierinvoice",
  "order",
  "offer",
  "bookkeeping",
  "project",
  "costcenter"
];
