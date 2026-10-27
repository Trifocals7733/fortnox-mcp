/**
 * Fortnox MCP Server
 *
 * An MCP server for the Fortnox Swedish accounting API. One Fortnox user per
 * process, configured with:
 *
 *   FORTNOX_CLIENT_ID      Fortnox app client ID
 *   FORTNOX_CLIENT_SECRET  Fortnox app client secret
 *   FORTNOX_REFRESH_TOKEN  OAuth2 refresh token (rotated into ~/.fortnox-mcp)
 *   TRANSPORT              'stdio' (default) or 'http'
 *   PORT                   HTTP port when TRANSPORT=http (default 3000)
 */

import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import express from "express";
import { getTokenProvider } from "./auth/index.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./server/mcp.js";
import { closeRuntime } from "./services/runtime.js";

async function runStdio(): Promise<void> {
  try {
    if (!getTokenProvider().isAuthenticated()) {
      throw new Error("FORTNOX_REFRESH_TOKEN not set");
    }
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runHTTP(): Promise<void> {
  try {
    if (!getTokenProvider().isAuthenticated()) {
      throw new Error("FORTNOX_REFRESH_TOKEN not set");
    }
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const server = createMcpServer();
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "fortnox-mcp-server", mode: "local-http" });
  });

  // MCP endpoint
  app.post("/mcp", async (req, res) => {
    // Create new transport for each request (stateless)
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    res.on("close", () => transport.close());

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.error(`[FortnoxMCP] http://localhost:${port}/mcp`);
  });
}

async function main(): Promise<void> {
  try {
    const config = loadConfig();

    if (config.transport === "http") {
      await runHTTP();
    } else {
      await runStdio();
    }
  } catch (error) {
    console.error("Server error:", error);
    process.exit(1);
  }
}

main();

// Release the Effect runtime (rate-limiter state, HTTP client) on the way out.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void closeRuntime().finally(() => process.exit(0));
  });
}
