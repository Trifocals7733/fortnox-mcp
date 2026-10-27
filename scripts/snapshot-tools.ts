#!/usr/bin/env npx tsx
/**
 * Freezes the advertised MCP tool surface (tools/list) to a checked-in file.
 *
 *   npm run snapshot:tools   # write test/tools-baseline.json
 *   npm run check:tools      # diff against it, exit 1 on any drift
 *
 * This is the safety net for refactors: the SDK's tools/list output is what
 * clients actually see, so a dropped tool, a renamed argument or a lost
 * description shows up as a diff line. Needs no Fortnox credentials — the
 * server is connected over an in-memory transport, never through a network.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../src/server/mcp.js";

const BASELINE_PATH = "test/tools-baseline.json";

interface ToolSnapshot {
  name: string;
  title: string | null;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  annotations: unknown;
}

async function snapshotTools(): Promise<ToolSnapshot[]> {
  const server = createMcpServer();
  const client = new Client({ name: "snapshot", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const { tools } = await client.listTools();
    return tools
      .map((tool) => ({
        name: tool.name,
        title: tool.title ?? null,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema ?? null,
        outputSchema: tool.outputSchema ?? null,
        annotations: tool.annotations ?? null
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await client.close();
    await server.close();
  }
}

function diff(baseline: ToolSnapshot[], current: ToolSnapshot[]): string[] {
  const problems: string[] = [];
  const before = new Map(baseline.map((t) => [t.name, t]));
  const after = new Map(current.map((t) => [t.name, t]));

  for (const name of before.keys()) {
    if (!after.has(name)) problems.push(`removed tool: ${name}`);
  }
  for (const name of after.keys()) {
    if (!before.has(name)) problems.push(`added tool: ${name}`);
  }
  for (const [name, oldTool] of before) {
    const newTool = after.get(name);
    if (!newTool) continue;
    const fields: (keyof ToolSnapshot)[] = [
      "title",
      "description",
      "inputSchema",
      "outputSchema",
      "annotations"
    ];
    for (const field of fields) {
      if (JSON.stringify(oldTool[field]) !== JSON.stringify(newTool[field])) {
        problems.push(`changed ${field}: ${name}`);
      }
    }
  }
  return problems;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const current = await snapshotTools();

  if (!check) {
    mkdirSync("test", { recursive: true });
    writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
    console.log(`Wrote ${current.length} tools to ${BASELINE_PATH}`);
    return;
  }

  if (!existsSync(BASELINE_PATH)) {
    console.error(`No baseline at ${BASELINE_PATH}. Run: npm run snapshot:tools`);
    process.exit(1);
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as ToolSnapshot[];
  const problems = diff(baseline, current);
  if (problems.length === 0) {
    console.log(`Tool surface unchanged (${current.length} tools).`);
    return;
  }

  console.error(`Tool surface changed (${baseline.length} -> ${current.length} tools):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
