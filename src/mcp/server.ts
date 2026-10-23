/**
 * SeatView MCP server：把 tools.ts 的處理函式註冊成 MCP tool。
 * 進入點在 main.ts（stdio）；測試用 InMemoryTransport 直接連這裡建立的 server。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { compareSeats, getSeatViewTool, getVenueProvenance, listSectionsTool, listVenues, type ToolOutcome } from "./tools.ts";
import type { VenueRegistry } from "./venues.ts";

const SIGN_CONVENTIONS =
  "單位：公尺、度。focus 在演唱會是舞台、在棒球是本壘。俯角為正 = 比 focus 高、往下看。" +
  "水平偏角 0 = 正對 focus 的正面，正值 = 觀眾面向 focus 時的右手邊（棒球：0° = 本壘正後方、一壘側為正）。";
const NOT_TICKETS = "區、排、號是模型內部編號，不對應實際票面。";

// ── 輸出 schema ──
const named = z.object({ id: z.string(), name: z.string() });
const vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });
const metrics = z.object({
  distance: z.number().describe("眼睛到 focus 的直線距離（m）"),
  horizontalDistance: z.number().describe("平面距離（m）"),
  heightAboveFocus: z.number().describe("眼睛比 focus 高幾公尺（負值 = 比較低）"),
  elevationDeg: z.number().describe("俯角（度），正 = 往下看"),
  horizontalDeg: z.number().describe("水平偏角（度），範圍 (-180, 180]"),
});
const direction = z.enum(["正面", "右前方", "右側", "右後方", "背面", "左後方", "左側", "左前方"]);
const toolError = z.object({ code: z.string(), message: z.string(), hint: z.string().optional() });
const disclaimer = z.string().optional().describe("近似模型的免責聲明；有的話一定要轉告使用者");

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** 成功 → 結構化資料 + 中文摘要；失敗 → isError + 附代碼與提示的訊息（不帶結構化資料）。 */
function toResult<T>(outcome: ToolOutcome<T>): CallToolResult {
  const content = [{ type: "text" as const, text: outcome.text }];
  return outcome.ok ? { content, structuredContent: outcome.data as Record<string, unknown> } : { content, isError: true };
}

export function createMcpServer(registry: VenueRegistry): McpServer {
  const [first, ...rest] = registry.ids;
  if (first === undefined) throw new Error("沒有任何場館可以提供");
  const venue = z.enum([first, ...rest]).describe("場館 id（用 list_venues 查）");
  const layout = z.string().min(1).describe("layout id，例如 concert、baseball（用 list_venues 查）");
  const seatRef = {
    section: z.string().min(1).describe("區 id，例如 113（官方票區號；用 list_sections 查）"),
    row: z.number().int().min(1).describe("排號，從 1 開始"),
    seat: z.number().int().min(1).describe("座號，從 1 開始"),
  };

  const server = new McpServer({ name: "seatview", version: "0.1.0" });

  server.registerTool(
    "list_venues",
    {
      title: "列出場館",
      description: "列出可以查詢的場館與各自的 layout（例如演唱會、棒球）。近似模型會附免責聲明。",
      outputSchema: {
        venues: z.array(named.extend({ layouts: z.array(named), sectionCount: z.number().int(), disclaimer })),
      },
      annotations: READ_ONLY,
    },
    () => toResult(listVenues(registry)),
  );

  server.registerTool(
    "list_sections",
    {
      title: "列出區",
      description: `列出某場館某 layout 開放的區，含每排席數。呼叫 get_seat_view 前，先用它確認排號與座號的範圍。${NOT_TICKETS}`,
      inputSchema: { venue, layout },
      outputSchema: {
        venue: named,
        layout: named,
        sections: z.array(
          z.object({
            id: z.string(),
            name: z.string().optional(),
            rows: z.number().int(),
            totalSeats: z.number().int(),
            seatsPerRow: z.array(z.number().int()).describe("第 1 排到最後一排的席數"),
          }),
        ),
      },
      annotations: READ_ONLY,
    },
    (input) => toResult(listSectionsTool(registry, input)),
  );

  server.registerTool(
    "get_seat_view",
    {
      title: "查座位視野",
      description: `查一個座位看出去的視野：座位與相機位置、到 focus 的距離、俯角、水平偏角與方位。${SIGN_CONVENTIONS}${NOT_TICKETS}`,
      inputSchema: { venue, layout, ...seatRef },
      outputSchema: {
        venue: named,
        layout: named,
        section: z.object({ id: z.string(), name: z.string().optional() }),
        row: z.number().int(),
        seat: z.number().int(),
        seatPosition: vec3.describe("座位地面中心（m）"),
        camera: z.object({ position: vec3.describe("眼睛位置"), target: vec3.describe("看向的 focus") }),
        metrics,
        direction: direction.describe("相對 focus 朝向的方位：±15° 內為正面，60°、120°、165° 分界"),
        disclaimer,
      },
      annotations: READ_ONLY,
    },
    (input) => toResult(getSeatViewTool(registry, input)),
  );

  server.registerTool(
    "compare_seats",
    {
      title: "比較座位",
      description: `一次比較 2–10 個座位的距離、俯角、水平偏角，並依距離與正中程度排名。單一座位出錯不影響其他座位。${SIGN_CONVENTIONS}`,
      inputSchema: { venue, layout, seats: z.array(z.object(seatRef)).min(2).max(10) },
      outputSchema: {
        venue: named,
        layout: named,
        results: z.array(
          z.union([
            z.object({ ...seatRef, ok: z.literal(true), metrics, direction }),
            z.object({ ...seatRef, ok: z.literal(false), error: toolError }),
          ]),
        ),
        ranking: z.object({
          byDistance: z.array(z.number().int()).describe("results 的 index，由近到遠（只含成功的座位）"),
          byCenter: z.array(z.number().int()).describe("results 的 index，由正中到偏（依 |水平偏角|）"),
        }),
        disclaimer,
      },
      annotations: READ_ONLY,
    },
    (input) => toResult(compareSeats(registry, input)),
  );

  server.registerTool(
    "get_venue_provenance",
    {
      title: "數字來源",
      description: "列出場館數字的來源與等級（A = 規則或官方定義、B = 新聞報導、C = 本專案估算）。引用數字前，先用它確認哪些只是估算。",
      inputSchema: { venue },
      outputSchema: {
        venue: named,
        disclaimer,
        provenance: z.array(z.object({ key: z.string(), value: z.string(), grade: z.enum(["A", "B", "C"]), source: z.string() })),
      },
      annotations: READ_ONLY,
    },
    (input) => toResult(getVenueProvenance(registry, input)),
  );

  return server;
}
