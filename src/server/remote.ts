import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { mcpAuthRouter, requireBearerAuth } from "@modelcontextprotocol/server-legacy/auth";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { runWithContext } from "../auth/context.js";
import {
  FortnoxProxyOAuthProvider,
  getUserIdFromAuth,
  initializeTokenProvider
} from "../auth/index.js";
import type { ITokenStorage } from "../auth/storage/types.js";
import { createMcpServer } from "./mcp.js";

export interface RemoteServerOptions {
  serverUrl: string;
  jwtSecret: string;
  tokenStorage: ITokenStorage;
  port?: number;
}

export function createRemoteServer(options: RemoteServerOptions): Express {
  const { serverUrl, jwtSecret, tokenStorage } = options;

  const oauthProvider = new FortnoxProxyOAuthProvider(jwtSecret, serverUrl, tokenStorage);

  initializeTokenProvider(oauthProvider.getTokenProvider());

  const app = express();
  app.use(express.json());

  // Trust proxy headers (for Vercel, etc.)
  app.set("trust proxy", 1);

  // Health check endpoint (no auth required)
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      server: "fortnox-mcp-server",
      mode: "remote"
    });
  });

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL(serverUrl),
      scopesSupported: ["fortnox:read", "fortnox:write"],
      resourceName: "Fortnox MCP Server"
    })
  );

  // Fortnox OAuth callback handler
  app.get("/oauth/fortnox/callback", async (req, res) => {
    try {
      const { code, state, error, error_description } = req.query;

      if (error) {
        console.error(`[OAuth] Fortnox error: ${error} - ${error_description}`);
        res
          .status(400)
          .type("text")
          .send(`OAuth error: ${error_description || error}`);
        return;
      }

      if (!code || !state) {
        res.status(400).type("text").send("Missing code or state parameter");
        return;
      }

      const result = await oauthProvider.handleFortnoxCallback(code as string, state as string);

      // Redirect back to Claude with our authorization code
      const redirectUrl = new URL(result.redirectUri);
      redirectUrl.searchParams.set("code", result.code);
      if (result.state) {
        redirectUrl.searchParams.set("state", result.state);
      }

      res.redirect(redirectUrl.toString());
    } catch (error) {
      console.error("[OAuth] Callback error:", error);
      res.status(500).type("text").send("OAuth callback failed");
    }
  });

  const mcpServer = createMcpServer();

  // Protected MCP endpoint
  app.post(
    "/mcp",
    /* @mcp-codemod-error requireBearerAuth: resource-server auth helpers routed to the frozen @modelcontextprotocol/server-legacy/auth copy. The maintained v2 home is @modelcontextprotocol/express — when re-pointing, verifiers must throw the v2 OAuthError (the express middleware does not recognize the legacy error classes). See the migration guide's server auth split section. */
    requireBearerAuth({
      verifier: oauthProvider,
      resourceMetadataUrl: `${serverUrl}/.well-known/oauth-protected-resource`
    }),
    async (req: Request, res: Response) => {
      try {
        const userId = req.auth ? getUserIdFromAuth(req.auth) : undefined;

        if (!userId) {
          res.status(401).json({ error: "No user context" });
          return;
        }

        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true
        });

        res.on("close", () => transport.close());

        await runWithContext({ userId }, async () => {
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, req.body);
        });
      } catch (error) {
        console.error("[MCP] Request error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Server] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

export async function runRemoteServer(options: RemoteServerOptions): Promise<void> {
  const app = createRemoteServer(options);
  const port = options.port || parseInt(process.env.PORT || "3000", 10);

  app.listen(port, () => {
    console.error(`[FortnoxMCP] Remote server: http://localhost:${port}`);
  });
}
