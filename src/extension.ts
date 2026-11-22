// Entry point for the Claude Desktop extension (.mcpb). Always starts the server;
// configuration comes from the extension's settings via environment variables.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createEtsyMcpServer } from "./server.js";

const apiKey = process.env.ETSY_API_KEY?.trim();
const sharedSecret = process.env.ETSY_SHARED_SECRET?.trim();

if (!apiKey || !sharedSecret) {
  console.error("Etsy API keystring and shared secret are required. Add them in the extension settings in Claude Desktop.");
  process.exit(1);
}

const server = createEtsyMcpServer({ apiKey, sharedSecret });
server.connect(new StdioServerTransport()).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
