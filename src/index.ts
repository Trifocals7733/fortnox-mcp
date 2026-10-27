#!/usr/bin/env node
/**
 * Fortnox MCP Server
 *
 * An MCP server for integrating with the Fortnox Swedish accounting system.
 * Provides tools for managing invoices, customers, suppliers, accounts, and vouchers.
 *
 * Supports two modes:
 *
 * LOCAL MODE (default):
 *   Run with npx, users provide their own refresh token
 *   - FORTNOX_CLIENT_ID: Fortnox app client ID (can be embedded)
 *   - FORTNOX_CLIENT_SECRET: Fortnox app client secret (can be embedded)
 *   - FORTNOX_REFRESH_TOKEN: User's OAuth2 refresh token
 *   - TRANSPORT: 'stdio' (default) or 'http'
 *   - PORT: HTTP server port (default: 3000)
 *
 * REMOTE MODE (AUTH_MODE=remote):
 *   Hosted server with OAuth flow
 *   - AUTH_MODE: Set to 'remote'
 *   - SERVER_URL: Public URL of the server
 *   - JWT_SECRET: Secret for signing JWT tokens
 *   - UPSTASH_REDIS_REST_URL: Redis URL for token storage
 *   - UPSTASH_REDIS_REST_TOKEN: Redis token
 */

import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import express from "express";
import { getTokenProvider } from "./auth/index.js";
import { getStorageFromEnv } from "./auth/storage/index.js";
import { loadConfig, logConfig, validateEnvironment } from "./config.js";
import { createMcpServer } from "./server/mcp.js";
import { runRemoteServer } from "./server/remote.js";
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

async function runLocalHTTP(): Promise<void> {
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
    validateEnvironment(config);
    logConfig(config);

    if (config.authMode === "remote") {
      // Remote mode: OAuth with token storage
      const tokenStorage = getStorageFromEnv();
      await runRemoteServer({
        serverUrl: config.serverUrl!,
        jwtSecret: config.jwtSecret!,
        tokenStorage,
        port: config.port
      });
    } else if (config.transport === "http") {
      // Local HTTP mode (no OAuth, uses env vars)
      await runLocalHTTP();
    } else {
      // Local stdio mode (default)
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
