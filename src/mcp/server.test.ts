import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "./server.ts";
import { loadVenues } from "./venues.ts";

const TOOL_NAMES = ["compare_seats", "get_seat_view", "get_venue_provenance", "list_sections", "list_venues"];

/** 在記憶體裡把 client 和 server 接起來，走完整的 MCP 協定（含 SDK 的輸入／輸出 schema 驗證）。 */
async function connect() {
  const server = createMcpServer(loadVenues());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "seatview-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

/** callTool 的回傳型別是好幾種結果的聯集，這裡只取文字內容。 */
function textOf(result: unknown): string {
  const content = ((result as { content?: unknown }).content ?? []) as { type: string; text?: string }[];
  return content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
}

describe("MCP server（InMemoryTransport 端到端）", () => {
  it("列出 5 個 tool，每個都有輸入與輸出 schema、標成唯讀", async () => {
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(TOOL_NAMES);
      for (const tool of tools) {
        expect(tool.inputSchema.type, tool.name).toBe("object");
        expect(tool.outputSchema?.type, tool.name).toBe("object");
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
        expect(tool.description?.length, tool.name).toBeGreaterThan(10);
      }
      const seatView = tools.find((t) => t.name === "get_seat_view");
      const props = seatView?.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(props.venue?.enum).toEqual(["demo-arena", "taipei-dome"]);
      expect(seatView?.inputSchema.required).toEqual(expect.arrayContaining(["venue", "layout", "section", "row", "seat"]));
    } finally {
      await close();
    }
  });

  it("get_seat_view：回傳符合 outputSchema 的結構化資料與中文摘要", async () => {
    const { client, close } = await connect();
    try {
      const result = await client.callTool({
        name: "get_seat_view",
        arguments: { venue: "demo-arena", layout: "concert", section: "A1", row: 1, seat: 16 },
      });
      expect(result.isError, textOf(result)).toBeFalsy();
      const data = result.structuredContent as { metrics: { distance: number }; direction: string };
      expect(data.metrics.distance).toBeCloseTo(60.012, 3);
      expect(data.direction).toBe("正面");
      expect(textOf(result)).toContain("第 1 排 16 號");
    } finally {
      await close();
    }
  });

  it("其他 4 個 tool 都能呼叫成功，結構化資料通過 outputSchema 驗證", async () => {
    const { client, close } = await connect();
    try {
      const calls = [
        { name: "list_venues", arguments: {} },
        { name: "list_sections", arguments: { venue: "taipei-dome", layout: "concert" } },
        {
          name: "compare_seats",
          arguments: {
            venue: "taipei-dome",
            layout: "baseball",
            seats: [
              { section: "113", row: 9, seat: 2 },
              { section: "113", row: 9, seat: 999 },
            ],
          },
        },
        { name: "get_venue_provenance", arguments: { venue: "taipei-dome" } },
      ];
      for (const call of calls) {
        const result = await client.callTool(call);
        expect(result.isError, `${call.name}：${textOf(result)}`).toBeFalsy();
        expect(result.structuredContent, call.name).toBeDefined();
      }
    } finally {
      await close();
    }
  });

  it("座位不存在：isError，訊息附錯誤代碼與提示", async () => {
    const { client, close } = await connect();
    try {
      const result = await client.callTool({
        name: "get_seat_view",
        arguments: { venue: "taipei-dome", layout: "baseball", section: "F1", row: 1, seat: 1 },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("SECTION_NOT_IN_LAYOUT");
      expect(textOf(result)).toContain("113");
    } finally {
      await close();
    }
  });

  it.each([
    ["排號不是正整數", { venue: "demo-arena", layout: "concert", section: "A1", row: 1.5, seat: 1 }],
    ["場館不在清單裡", { venue: "nope", layout: "concert", section: "A1", row: 1, seat: 1 }],
    ["缺少參數", { venue: "demo-arena", layout: "concert" }],
  ])("輸入不符合 schema（%s）：isError，不會執行 core", async (_label, args) => {
    const { client, close } = await connect();
    try {
      const result = await client.callTool({ name: "get_seat_view", arguments: args });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("Input validation error");
    } finally {
      await close();
    }
  });
});

describe("MCP server × 大巨蛋資料（端到端）", () => {
  it("get_seat_view 成功：113 區第 9 排 2 號（3 席的中間）正對本壘，距離 √(25.10² + 3.20²) ≈ 25.30 m，附免責聲明", async () => {
    const { client, close } = await connect();
    try {
      const result = await client.callTool({
        name: "get_seat_view",
        arguments: { venue: "taipei-dome", layout: "baseball", section: "113", row: 9, seat: 2 },
      });
      expect(result.isError, textOf(result)).toBeFalsy();
      const data = result.structuredContent as {
        metrics: { distance: number; horizontalDeg: number };
        direction: string;
        disclaimer?: string;
      };
      // 第 9 排：離本壘 18.3 + 8 × 0.85 m；眼睛高 0（B1 第 1 排跟場地同高）+ 8 × 0.35 + 1.2 m，好球帶 0.8 m
      expect(data.metrics.distance).toBeCloseTo(Math.hypot(18.3 + 8 * 0.85, 0 + 8 * 0.35 + 1.2 - 0.8), 3);
      expect(data.metrics.horizontalDeg).toBeCloseTo(0, 6);
      expect(data.direction).toBe("正面");
      expect(data.disclaimer).toContain("不應作為購票依據");
      expect(textOf(result)).toContain("不應作為購票依據");
    } finally {
      await close();
    }
  });

  it("未建模的區 233（L2 外野）→ UNKNOWN_SECTION，提示 baseball 開放的區", async () => {
    const { client, close } = await connect();
    try {
      const result = await client.callTool({
        name: "get_seat_view",
        arguments: { venue: "taipei-dome", layout: "baseball", section: "233", row: 1, seat: 1 },
      });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain("UNKNOWN_SECTION");
      expect(text).toContain("baseball 開放的區");
      expect(text).toContain("140");
    } finally {
      await close();
    }
  });

  it("140 在 concert 沒開放 → SECTION_NOT_IN_LAYOUT，提示 concert 開放的區（不含舞台後方的 136、137、140、141）", async () => {
    const { client, close } = await connect();
    try {
      const result = await client.callTool({
        name: "get_seat_view",
        arguments: { venue: "taipei-dome", layout: "concert", section: "140", row: 1, seat: 1 },
      });
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text).toContain("SECTION_NOT_IN_LAYOUT");
      const hint = text.split("\n").find((line) => line.startsWith("concert 開放的區"));
      const open = hint?.split("：")[1]?.split("、") ?? [];
      expect(open).toContain("F1");
      for (const id of ["136", "137", "140", "141"]) expect(open).not.toContain(id);
    } finally {
      await close();
    }
  });
});
