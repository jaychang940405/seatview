/**
 * SeatView MCP server 的進入點（stdio）。
 *   npm run mcp
 *   claude mcp add seatview -- node <專案路徑>/src/mcp/main.ts
 * stdout 只給 MCP 協定使用，log 一律寫到 stderr。
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.ts";
import { loadVenues } from "./venues.ts";

try {
  const registry = loadVenues();
  await createMcpServer(registry).connect(new StdioServerTransport());
  process.stderr.write(`seatview MCP server 已啟動（場館：${registry.ids.join("、")}）\n`);
} catch (error) {
  process.stderr.write(`seatview MCP server 啟動失敗：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
