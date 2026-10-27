#!/usr/bin/env npx tsx
/**
 * Fortnox OAuth2 Token Helper
 *
 * This script helps you obtain a refresh token through the OAuth2 flow.
 *
 * Usage:
 *   1. Run: npm run get-token
 *   2. Open the printed URL in your browser
 *   3. Authorize the app in Fortnox; the redirect is caught on port 8888
 *   4. The refresh token is persisted to ~/.fortnox-mcp/tokens.json
 *
 * Uses PKCE (S256) and a random, verified `state`, as RFC 8252 asks of a
 * native/CLI app with a loopback redirect. Fortnox also requires a client
 * secret on the token exchange, so PKCE is defence in depth rather than the
 * only thing standing between an intercepted code and a token.
 */

import crypto from "node:crypto";
import http from "http";
import { URL } from "url";
import { FORTNOX_SCOPES } from "../src/auth/credentials.js";
import { persistTokens } from "../src/auth/fileTokenStore.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} must be set in your environment.`);
    console.error("Register an app at https://developer.fortnox.se to get your credentials.");
    process.exit(1);
  }
  return value;
}

const CLIENT_ID = requireEnv("FORTNOX_CLIENT_ID");
const CLIENT_SECRET = requireEnv("FORTNOX_CLIENT_SECRET");
const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

// One copy of the scope list, in credentials.ts, so the test that checks it
// also covers this flow.
const SCOPES = FORTNOX_SCOPES;

const base64url = (buffer: Buffer): string =>
  buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** PKCE verifier + its S256 challenge (RFC 7636). */
function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function getAuthorizationCode(challenge: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "", `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h1>Error: ${error}</h1><p>${url.searchParams.get("error_description")}</p>`);
          reject(new Error(error));
          server.close();
          return;
        }

        const returnedState = url.searchParams.get("state");
        if (returnedState !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(
            "<h1>State mismatch</h1><p>Authorization response did not match this request.</p>"
          );
          reject(new Error("State mismatch - possible CSRF, authorization aborted"));
          server.close();
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: sans-serif; padding: 40px; text-align: center;">
                <h1>✓ Authorization Successful!</h1>
                <p>You can close this window and return to the terminal.</p>
                <p style="color: #666;">Authorization code received.</p>
              </body>
            </html>
          `);
          resolve(code);
          setTimeout(() => server.close(), 1000);
        }
      }
    });

    server.listen(REDIRECT_PORT, () => {
      const authUrl = new URL("https://apps.fortnox.se/oauth-v1/auth");
      authUrl.searchParams.set("client_id", CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authUrl.searchParams.set("scope", SCOPES.join(" "));
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("state", expectedState);
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");

      console.log("\n╔════════════════════════════════════════════════════════════╗");
      console.log("║           FORTNOX OAUTH2 AUTHORIZATION                      ║");
      console.log("╚════════════════════════════════════════════════════════════╝\n");
      console.log("Step 1: Open this URL in your browser:\n");
      console.log(`  ${authUrl.toString()}\n`);
      console.log("Step 2: Log in to Fortnox and authorize the application\n");
      console.log("Step 3: You will be redirected back here automatically\n");
      console.log("Waiting for authorization...\n");
    });

    server.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        console.error(
          `Port ${REDIRECT_PORT} is already in use. Please close other applications using it.`
        );
      }
      reject(err);
    });
  });
}

async function exchangeCodeForTokens(
  code: string,
  verifier: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}> {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  const response = await fetch("https://apps.fortnox.se/oauth-v1/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

async function main() {
  try {
    console.log("Starting OAuth2 authorization flow...\n");

    const pkce = createPkcePair();
    const state = base64url(crypto.randomBytes(16));
    const code = await getAuthorizationCode(pkce.challenge, state);
    console.log("✓ Authorization code received\n");

    console.log("Exchanging code for tokens...\n");
    const tokens = await exchangeCodeForTokens(code, pkce.verifier);

    // Keep the token store in step with .env: the provider prefers the
    // persisted file, so a stale file there would shadow the new token.
    persistTokens(
      tokens.refresh_token,
      tokens.access_token,
      Date.now() + tokens.expires_in * 1000,
      tokens.scope
    );

    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║                    SUCCESS!                                 ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    console.log("Add these to your environment:\n");
    console.log("─────────────────────────────────────────────────────────────");
    console.log(`export FORTNOX_CLIENT_ID="${CLIENT_ID}"`);
    console.log(`export FORTNOX_CLIENT_SECRET="${CLIENT_SECRET}"`);
    console.log(`export FORTNOX_REFRESH_TOKEN="${tokens.refresh_token}"`);
    console.log("─────────────────────────────────────────────────────────────\n");

    console.log("Or add to Claude Desktop config:\n");
    console.log(
      JSON.stringify(
        {
          env: {
            FORTNOX_CLIENT_ID: CLIENT_ID,
            FORTNOX_CLIENT_SECRET: CLIENT_SECRET,
            FORTNOX_REFRESH_TOKEN: tokens.refresh_token
          }
        },
        null,
        2
      )
    );

    console.log("\n✓ Done! You can now use the Fortnox MCP server.\n");
  } catch (error) {
    console.error("\n✗ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
