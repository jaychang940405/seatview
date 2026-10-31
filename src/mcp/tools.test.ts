import { describe, expect, it } from "vitest";
import { parseVenue } from "../core/schema.ts";
import { getSeatView } from "../core/view.ts";
import {
  compareSeats,
  directionOf,
  getSeatViewTool,
  getVenueProvenance,
  listSectionsTool,
  listVenues,
  type ToolOutcome,
} from "./tools.ts";
import { loadVenues } from "./venues.ts";
import demoArenaJson from "../venues/demo-arena.json";

// 每個測試各自讀場館：實作壞掉時各案例各自失敗
const registry = () => loadVenues();

function ok<T>(outcome: ToolOutcome<T>): T {
  if (!outcome.ok) throw new Error(`預期成功，卻得到 ${outcome.error.code}：${outcome.error.message}`);
  return outcome.data;
}

function failed<T>(outcome: ToolOutcome<T>) {
  if (outcome.ok) throw new Error("預期失敗，卻成功了");
  return outcome;
}

describe("loadVenues", () => {
  it("讀到 src/venues 下所有場館，依 id 排序，內容經過 parseVenue 驗證", () => {
    const venues = registry();
    expect(venues.ids).toEqual(["demo-arena", "taipei-dome"]);
    expect(venues.get("demo-arena")).toEqual(parseVenue(demoArenaJson));
    expect(venues.get("nope")).toBeUndefined();
  });
});

describe("directionOf", () => {
  it.each([
    [0, "正面"],
    [15, "正面"],
    [-15, "正面"],
    [16, "右前方"],
    [-30, "左前方"],
    [60.5, "右側"],
    [90, "右側"],
    [-120, "左側"],
    [130, "右後方"],
    [-165, "左後方"],
    [170, "背面"],
    [-180, "背面"],
  ] as const)("%s° → %s", (deg, label) => {
    expect(directionOf(deg)).toBe(label);
  });
});

describe("list_venues", () => {
  it("列出兩個場館與各自的 layout；只有近似模型附免責聲明", () => {
    const { venues } = ok(listVenues(registry()));
    expect(venues.map((v) => v.id)).toEqual(["demo-arena", "taipei-dome"]);
    const dome = venues.find((v) => v.id === "taipei-dome");
    expect(dome?.layouts.map((l) => l.id).sort()).toEqual(["baseball", "concert"]);
    // 官方票區 61 區（B1 內野 23、B1 外野 14、L2 內野 24）＋演唱會搖滾區 3 區
    expect(dome?.sectionCount).toBe(64);
    expect(dome?.disclaimer).toContain("不應作為購票依據");
    expect(venues.find((v) => v.id === "demo-arena")?.disclaimer).toBeUndefined();
  });
});

describe("list_sections", () => {
  it("只列出這個 layout 開放的區，每區附每排席數與總席數", () => {
    const { layout, sections } = ok(listSectionsTool(registry(), { venue: "taipei-dome", layout: "baseball" }));
    expect(layout.name).toBe("棒球");
    expect(sections.map((s) => s.id)).not.toContain("F1");
    for (const s of sections) {
      expect(s.seatsPerRow).toHaveLength(s.rows);
      expect(s.totalSeats).toBe(s.seatsPerRow.reduce((a, b) => a + b, 0));
    }
  });

  it("有樓層的區附上 level，摘要也寫出來；沒有樓層的區（示範場館）不附", () => {
    const outcome = listSectionsTool(registry(), { venue: "taipei-dome", layout: "baseball" });
    const { sections } = ok(outcome);
    expect(sections.find((s) => s.id === "113")?.level).toBe("B1");
    expect(sections.find((s) => s.id === "212")?.level).toBe("L2");
    expect(outcome.text).toContain("- 212［L2］：");
    const demo = ok(listSectionsTool(registry(), { venue: "demo-arena", layout: "concert" }));
    expect(demo.sections.every((s) => !("level" in s))).toBe(true);
  });
});

describe("get_seat_view", () => {
  it("數字跟 core 的 getSeatView 完全一致，並附方位與中文摘要", () => {
    const data = ok(getSeatViewTool(registry(), { venue: "demo-arena", layout: "concert", section: "A1", row: 1, seat: 16 }));
    const expected = getSeatView(parseVenue(demoArenaJson), "concert", "A1", 1, 16);
    expect(data.metrics).toEqual(expected.metrics);
    expect(data.camera).toEqual(expected.camera);
    expect(data.seatPosition).toEqual(expected.seatPosition);
    expect(data.direction).toBe("正面");
    expect(data.disclaimer).toBeUndefined();
  });

  it("中文摘要包含區排號、距離與方位", () => {
    const outcome = getSeatViewTool(registry(), { venue: "demo-arena", layout: "concert", section: "A1", row: 1, seat: 16 });
    expect(outcome.text).toContain("A1");
    expect(outcome.text).toContain("第 1 排 16 號");
    expect(outcome.text).toContain("60.0 m");
    expect(outcome.text).toContain("正面");
  });

  it("近似模型一定附上免責聲明（結構化資料與摘要都有）", () => {
    const outcome = getSeatViewTool(registry(), { venue: "taipei-dome", layout: "baseball", section: "105", row: 15, seat: 11 });
    const data = ok(outcome);
    expect(data.disclaimer).toContain("不應作為購票依據");
    expect(outcome.text).toContain("不應作為購票依據");
    expect(data.direction).toBe("右側");
  });
});

describe("錯誤：附代碼與改正提示", () => {
  it("不存在的場館 → UNKNOWN_VENUE，提示可用的場館", () => {
    const { error, text } = failed(getSeatViewTool(registry(), { venue: "nope", layout: "concert", section: "A1", row: 1, seat: 1 }));
    expect(error.code).toBe("UNKNOWN_VENUE");
    expect(error.hint).toContain("taipei-dome");
    expect(text).toContain("UNKNOWN_VENUE");
  });

  it("不存在的 layout → UNKNOWN_LAYOUT，提示可用的 layout", () => {
    const { error } = failed(listSectionsTool(registry(), { venue: "taipei-dome", layout: "opera" }));
    expect(error.code).toBe("UNKNOWN_LAYOUT");
    expect(error.hint).toContain("baseball");
  });

  it("這個 layout 沒開放的區 → SECTION_NOT_IN_LAYOUT，提示開放的區（不含 F1）", () => {
    const { error } = failed(getSeatViewTool(registry(), { venue: "taipei-dome", layout: "baseball", section: "F1", row: 1, seat: 1 }));
    expect(error.code).toBe("SECTION_NOT_IN_LAYOUT");
    expect(error.hint).toContain("113");
    expect(error.hint).not.toContain("F1");
  });

  it("不存在的區 → UNKNOWN_SECTION，提示開放的區", () => {
    const { error } = failed(getSeatViewTool(registry(), { venue: "taipei-dome", layout: "baseball", section: "233", row: 1, seat: 1 }));
    expect(error.code).toBe("UNKNOWN_SECTION");
    expect(error.hint).toContain("140");
  });

  it("座號超出範圍 → SEAT_OUT_OF_RANGE，訊息說明這排有幾號", () => {
    const { error } = failed(getSeatViewTool(registry(), { venue: "taipei-dome", layout: "baseball", section: "113", row: 1, seat: 999 }));
    expect(error.code).toBe("SEAT_OUT_OF_RANGE");
    expect(error.message).toContain("1–3");
  });
});

describe("compare_seats", () => {
  it("每席各自計算；錯誤的座位不影響其他席；排名只含成功的座位", () => {
    const data = ok(
      compareSeats(registry(), {
        venue: "taipei-dome",
        layout: "baseball",
        seats: [
          { section: "140", row: 1, seat: 11 },
          { section: "113", row: 4, seat: 2 },
          { section: "113", row: 4, seat: 999 },
          { section: "105", row: 15, seat: 11 },
        ],
      }),
    );
    expect(data.results.map((r) => r.ok)).toEqual([true, true, false, true]);
    // 距離：本壘後方 113 前排最近、一壘側 105 次之、中外野旁的 140 最遠；最正中的是 113 中央
    expect(data.ranking.byDistance).toEqual([1, 3, 0]);
    expect(data.ranking.byCenter[0]).toBe(1);
    expect(data.disclaimer).toContain("不應作為購票依據");
  });
});

describe("get_venue_provenance", () => {
  it("近似模型列出每個數字的等級與來源", () => {
    const { provenance, disclaimer } = ok(getVenueProvenance(registry(), { venue: "taipei-dome" }));
    expect(disclaimer).toContain("近似模型");
    expect(provenance.find((p) => p.key === "roofHeight")?.grade).toBe("B");
    expect(provenance.find((p) => p.key === "basePath")?.grade).toBe("A");
    expect(provenance.some((p) => p.grade === "C")).toBe(true);
  });

  it("沒有 meta 的場館回傳空的來源表", () => {
    const data = ok(getVenueProvenance(registry(), { venue: "demo-arena" }));
    expect(data.provenance).toEqual([]);
    expect(data.disclaimer).toBeUndefined();
  });
});
