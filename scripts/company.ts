#!/usr/bin/env npx tsx
/**
 * Switch between Fortnox companies (e.g. a test company and the live books).
 *
 *   npm run company                 # list known companies and which is active
 *   npm run company -- save 1888108 # archive the active token under a database number
 *   npm run company -- use 1888108  # make that archive the active token
 *
 * The server always uses ~/.fortnox-mcp/tokens.json (it wins over .env, because
 * Fortnox refresh tokens are single-use and that file holds the latest one).
 * Archives are the same JSON under tokens.<databaseNumber>.json.
 */

import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".fortnox-mcp");
const ACTIVE = join(DIR, "tokens.json");

interface Tokens {
  refreshToken: string;
  updatedAt: number;
  scope?: string;
}

function read(path: string): Tokens {
  return JSON.parse(readFileSync(path, "utf8")) as Tokens;
}

/** database number -> token file path */
function archives(): Map<string, string> {
  const found = new Map<string, string>();
  if (!existsSync(DIR)) return found;
  for (const name of readdirSync(DIR)) {
    const match = /^tokens\.(\d+)\.json$/.exec(name);
    if (match) found.set(match[1], join(DIR, name));
  }
  return found;
}

function requireActive(): Tokens {
  if (!existsSync(ACTIVE)) {
    console.error(`No token at ${ACTIVE}. Run: npm run get-token`);
    process.exit(1);
  }
  return read(ACTIVE);
}

function describe(path: string): string {
  const tokens = read(path);
  const when = new Date(tokens.updatedAt).toISOString().replace("T", " ").slice(0, 19);
  return `${when}Z  scopes: ${(tokens.scope ?? "-").slice(0, 48)}`;
}

function activeCompanyNumber(active: Tokens, known: Map<string, string>): string | undefined {
  for (const [databaseNumber, path] of known) {
    if (read(path).refreshToken === active.refreshToken) return databaseNumber;
  }
  return undefined;
}

function main(): void {
  const [command, argument] = process.argv.slice(2);
  const known = archives();
  const active = existsSync(ACTIVE) ? read(ACTIVE) : undefined;

  if (!command || command === "list") {
    const activeNumber = active ? activeCompanyNumber(active, known) : undefined;
    console.log(`Active (${ACTIVE}):`);
    if (!active) {
      console.log("  none - run `npm run get-token`");
    } else {
      console.log(`  company ${activeNumber ?? "UNKNOWN (not archived)"}`);
      console.log(`  ${describe(ACTIVE)}`);
    }
    console.log("\nArchived:");
    if (known.size === 0) console.log("  none");
    for (const [databaseNumber, path] of [...known].sort()) {
      console.log(`  ${databaseNumber}  ${describe(path)}`);
    }
    if (active && !activeNumber) {
      console.log(
        `\nThe active token belongs to no archive. Archive it with:\n  npm run company -- save <databaseNumber>`
      );
    }
    return;
  }

  if (command === "save") {
    if (!argument) {
      console.error("Usage: npm run company -- save <databaseNumber>");
      process.exit(1);
    }
    const tokens = requireActive();
    copyFileSync(ACTIVE, join(DIR, `tokens.${argument}.json`));
    console.log(`Archived the active token as tokens.${argument}.json (${describe(ACTIVE)})`);
    void tokens;
    return;
  }

  if (command === "use") {
    if (!argument) {
      console.error("Usage: npm run company -- use <databaseNumber>");
      process.exit(1);
    }
    const path = known.get(argument);
    if (!path) {
      console.error(
        `No archive for company ${argument}. Known: ${[...known.keys()].join(", ") || "none"}`
      );
      process.exit(1);
    }

    // Refuse to overwrite an active token that is not archived: its refresh
    // token is single-use, so it would be unrecoverable.
    const current = active ? activeCompanyNumber(active, known) : undefined;
    if (active && !current) {
      console.error(
        "The active token is not archived. Save it first so it can be restored:\n" +
          `  npm run company -- save <its database number>`
      );
      process.exit(1);
    }

    copyFileSync(path, ACTIVE);
    console.log(`Active company is now ${argument} (${describe(ACTIVE)})`);
    return;
  }

  console.error("Usage: npm run company [list | save <databaseNumber> | use <databaseNumber>]");
  process.exit(1);
}

main();
