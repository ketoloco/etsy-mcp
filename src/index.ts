#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { createEtsyMcpServer } from "./server.js";

export { createEtsyMcpServer } from "./server.js";
export type { ServerConfig } from "./server.js";

// CLI entry point - only run when executed directly
const currentFile = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && currentFile === process.argv[1];

if (isDirectRun) {
  // Load .env file when running as CLI
  // quiet: dotenv 17 logs to stdout by default, which corrupts the MCP stdio stream
  const { config: loadEnv } = await import("dotenv");
  loadEnv({ quiet: true });
  const apiKey = process.env.ETSY_API_KEY;
  const sharedSecret = process.env.ETSY_SHARED_SECRET;

  if (!apiKey || !sharedSecret) {
    console.error("Error: ETSY_API_KEY and ETSY_SHARED_SECRET environment variables are required.");
    console.error("See .env.example for the expected format.");
    process.exit(1);
  }

  const server = createEtsyMcpServer({ apiKey, sharedSecret });
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
