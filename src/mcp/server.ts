/**
 * SeatView MCP server：把 tools.ts 的處理函式註冊成 MCP tool。
 * 進入點在 main.ts（stdio）；測試用 InMemoryTransport 直接連這裡建立的 server。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VenueRegistry } from "./venues.ts";

export function createMcpServer(registry: VenueRegistry): McpServer {
  throw new Error("not implemented: createMcpServer");
}
