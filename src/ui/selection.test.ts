import { describe, expect, it } from "vitest";
import { SeatViewError } from "../core/errors";
import { parseVenue } from "../core/schema";
import { getSeatView } from "../core/view";
import demoArenaJson from "../venues/demo-arena.json";
import taipeiDomeJson from "../venues/taipei-dome.json";
import { parseSeatQuery } from "./query";
import { applyChange, normalize, panelOptions, stepValue, toSearch, type Selection } from "./selection";

const VENUES = [parseVenue(demoArenaJson), parseVenue(taipeiDomeJson)];

const dome = (layoutId: string, sectionId: string, row: number, seat: number, mode: Selection["mode"] = "seat"): Selection => ({
  venueId: "taipei-dome",
  layoutId,
  sectionId,
  row,
  seat,
  mode,
});

/** 用 core 查這個選擇；查得到回傳 undefined，查不到回傳錯誤代碼。 */
function errorCodeOf(selection: Selection): string | undefined {
  const venue = VENUES.find((v) => v.id === selection.venueId);
  if (!venue) throw new Error(`測試資料沒有 ${selection.venueId}`);
  try {
    getSeatView(venue, selection.layoutId, selection.sectionId, selection.row, selection.seat);
    return undefined;
  } catch (e) {
    if (e instanceof SeatViewError) return e.code;
    throw e;
  }
}

describe("panelOptions：面板的選項來自 core 的 listSections", () => {
  it("場館與 layout 依資料順序；區的標籤是「代號 名稱」", () => {
    const options = panelOptions(VENUES, dome("baseball", "I1-HP", 1, 29));
    expect(options.venues).toEqual([
      { id: "demo-arena", label: "示範體育館" },
      { id: "taipei-dome", label: "臺北大巨蛋（近似模型）" },
    ]);
    // short 給右上角的場地切換鈕用：名稱裡全形括號之前的部分
    expect(options.layouts).toEqual([
      { id: "baseball", label: "棒球", short: "棒球" },
      { id: "concert", label: "演唱會（暫定假設：外野端台）", short: "演唱會" },
    ]);
    expect(options.sections.map((s) => s.id)).toEqual(["I1-1B", "I1-HP", "I1-3B", "I2-1B", "I2-HP", "I2-3B", "O1-RF", "O1-CF", "O1-LF"]);
    expect(options.sections[1]).toEqual({ id: "I1-HP", label: "I1-HP 內野一層・本壘後方" });
  });

  it("名稱已經以代號開頭時不重複代號：demo-arena 的 A1 區 → 「A1 區」，不是「A1 A1 區」", () => {
    const start: Selection = { venueId: "demo-arena", layoutId: "concert", sectionId: "A1", row: 1, seat: 16, mode: "seat" };
    expect(panelOptions(VENUES, start).sections).toEqual([
      { id: "A1", label: "A1 區" },
      { id: "B1", label: "B1 區" },
      { id: "F1", label: "F1 搖滾 A" },
    ]);
  });

  it("演唱會 layout 有 F1–F3、沒有 O1-CF（共 11 區）", () => {
    const ids = panelOptions(VENUES, dome("concert", "I1-HP", 1, 29)).sections.map((s) => s.id);
    expect(ids).toHaveLength(11);
    expect(ids).toEqual(expect.arrayContaining(["F1", "F2", "F3"]));
    expect(ids).not.toContain("O1-CF");
  });

  it("排數與這一排的席數：I1-HP 有 30 排，第 1 排 57 席、第 30 排 134 席", () => {
    expect(panelOptions(VENUES, dome("baseball", "I1-HP", 1, 29))).toMatchObject({ rows: 30, seats: 57 });
    expect(panelOptions(VENUES, dome("baseball", "I1-HP", 30, 29))).toMatchObject({ rows: 30, seats: 134 });
  });

  it("排號不合法（第 99 排、NaN）→ seats 為 null", () => {
    expect(panelOptions(VENUES, dome("baseball", "I1-HP", 99, 1)).seats).toBeNull();
    expect(panelOptions(VENUES, dome("baseball", "I1-HP", Number.NaN, 1)).seats).toBeNull();
  });
});

describe("applyChange：換場館", () => {
  it("換到 demo-arena → 第一個 layout、第一區、第 1 排中間那一席（31 席 → 16 號），視角不變", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "O1-CF", 5, 10, "overview"), { kind: "venue", venueId: "demo-arena" });
    expect(selection).toEqual({ venueId: "demo-arena", layoutId: "concert", sectionId: "A1", row: 1, seat: 16, mode: "overview" });
    expect(notices).toEqual([]);
  });

  it("換到大巨蛋 → 棒球、I1-1B、第 1 排 58 號（115 席的中間）", () => {
    const start: Selection = { venueId: "demo-arena", layoutId: "concert", sectionId: "F1", row: 3, seat: 7, mode: "seat" };
    const { selection, notices } = applyChange(VENUES, start, { kind: "venue", venueId: "taipei-dome" });
    expect(selection).toEqual(dome("baseball", "I1-1B", 1, 58));
    expect(notices).toEqual([]);
  });
});

describe("applyChange：換 layout", () => {
  it("目前的區在新 layout 有開放 → 區排號都保留，沒有提示", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "I1-HP", 1, 29), { kind: "layout", layoutId: "concert" });
    expect(selection).toEqual(dome("concert", "I1-HP", 1, 29));
    expect(notices).toEqual([]);
  });

  it("目前的區在新 layout 沒開放 → 改成新 layout 第一區，並提示改了什麼", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "O1-CF", 5, 10), { kind: "layout", layoutId: "concert" });
    expect(selection).toEqual(dome("concert", "I1-1B", 5, 10));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("O1-CF");
    expect(notices[0]).toContain("I1-1B");
    expect(errorCodeOf(selection)).toBeUndefined();
  });
});

describe("applyChange：換區（原本合法的排號才會被修正）", () => {
  it("排號在新區仍合法 → 保留，沒有提示（方便比較不同區的同排同號）", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "I1-1B", 15, 58), { kind: "section", sectionId: "I1-3B" });
    expect(selection).toEqual(dome("baseball", "I1-3B", 15, 58));
    expect(notices).toEqual([]);
  });

  it("新區排數不夠 → 改成最後一排並提示：I1-1B 第 25 排 → I2-1B 只有 14 排", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "I1-1B", 25, 58), { kind: "section", sectionId: "I2-1B" });
    expect(selection).toEqual(dome("baseball", "I2-1B", 14, 58));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("1–14");
    expect(errorCodeOf(selection)).toBeUndefined();
  });

  it("新區這一排席數不夠 → 改成最後一號並提示：I1-HP 第 30 排 120 號 → I1-1B 只有 115 席", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "I1-HP", 30, 120), { kind: "section", sectionId: "I1-1B" });
    expect(selection).toEqual(dome("baseball", "I1-1B", 30, 115));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("1–115");
    expect(errorCodeOf(selection)).toBeUndefined();
  });
});

describe("applyChange：換排、換號（自己輸入的值不修正）", () => {
  it("換排讓原本合法的號數失效 → 改成這一排最後一號並提示：I1-HP 第 30 排 120 號 → 第 1 排只有 57 席", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "I1-HP", 30, 120), { kind: "row", row: 1 });
    expect(selection).toEqual(dome("baseball", "I1-HP", 1, 57));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("1–57");
  });

  it("自己輸入的排號超出範圍 → 不修正，交給 core 回報 ROW_OUT_OF_RANGE", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "I1-HP", 1, 29), { kind: "row", row: 99 });
    expect(selection).toEqual(dome("baseball", "I1-HP", 99, 29));
    expect(notices).toEqual([]);
    expect(errorCodeOf(selection)).toBe("ROW_OUT_OF_RANGE");
  });

  it("自己輸入的號數超出範圍 → 不修正，交給 core 回報 SEAT_OUT_OF_RANGE", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "I1-HP", 1, 29), { kind: "seat", seat: 999 });
    expect(selection).toEqual(dome("baseball", "I1-HP", 1, 999));
    expect(notices).toEqual([]);
    expect(errorCodeOf(selection)).toBe("SEAT_OUT_OF_RANGE");
  });

  it("原本就不合法的號數，換排時也不修正（它不是被連帶影響的）", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "I1-HP", 1, 999), { kind: "row", row: 30 });
    expect(selection).toEqual(dome("baseball", "I1-HP", 30, 999));
    expect(notices).toEqual([]);
  });

  it("pick（小地圖點選）：一次設定區、排、號，不修正、沒有提示", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "I1-HP", 1, 29), { kind: "pick", sectionId: "I2-HP", row: 7, seat: 60 });
    expect(selection).toEqual(dome("baseball", "I2-HP", 7, 60));
    expect(notices).toEqual([]);
  });

  it("切換視角只改 mode", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "I1-HP", 1, 29), { kind: "mode", mode: "overview" });
    expect(selection).toEqual(dome("baseball", "I1-HP", 1, 29, "overview"));
    expect(notices).toEqual([]);
  });
});

describe("normalize：處理網址參數", () => {
  it("合法的網址 → 原樣保留，沒有提示", () => {
    const query = parseSeatQuery("?venue=taipei-dome&layout=baseball&section=I1-HP&row=1&seat=29&mode=overview");
    expect(normalize(VENUES, query)).toEqual({ selection: query, notices: [] });
  });

  it("網址的排號超出範圍 → 不修正（和自己輸入一樣，交給 core 回報）", () => {
    const query = parseSeatQuery("?venue=taipei-dome&layout=baseball&section=I1-HP&row=99&seat=1");
    expect(normalize(VENUES, query)).toEqual({ selection: query, notices: [] });
  });

  it("不認得的場館 → 第一個場館的預設座位，並提示", () => {
    const { selection, notices } = normalize(VENUES, parseSeatQuery("?venue=nope&layout=baseball&section=I1-HP"));
    expect(selection).toEqual({ venueId: "demo-arena", layoutId: "concert", sectionId: "A1", row: 1, seat: 16, mode: "seat" });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("nope");
  });

  it("不認得的 layout → 第一個 layout，提示附 UNKNOWN_LAYOUT；區在新 layout 有開放就保留", () => {
    const { selection, notices } = normalize(VENUES, parseSeatQuery("?venue=taipei-dome&layout=opera&section=I1-HP&row=1&seat=29"));
    expect(selection).toEqual(dome("baseball", "I1-HP", 1, 29));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("UNKNOWN_LAYOUT");
    expect(notices[0]).toContain("opera");
  });

  it("未建模的區 → 這個 layout 的第一區，提示附 UNKNOWN_SECTION", () => {
    const { selection, notices } = normalize(VENUES, parseSeatQuery("?venue=taipei-dome&layout=baseball&section=O2-RF&row=1&seat=1"));
    expect(selection).toEqual(dome("baseball", "I1-1B", 1, 1));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("UNKNOWN_SECTION");
    expect(notices[0]).toContain("O2-RF");
  });

  it("這個 layout 沒開放的區 → 第一區並提示", () => {
    const { selection, notices } = normalize(VENUES, parseSeatQuery("?venue=taipei-dome&layout=concert&section=O1-CF&row=5&seat=10"));
    expect(selection).toEqual(dome("concert", "I1-1B", 5, 10));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("O1-CF");
  });
});

describe("stepValue：排、號的 − / + 按鈕", () => {
  it("一次加減 1，限制在 1 到上限之間", () => {
    expect(stepValue(5, 1, 10)).toBe(6);
    expect(stepValue(5, -1, 10)).toBe(4);
    expect(stepValue(1, -1, 10)).toBe(1);
    expect(stepValue(10, 1, 10)).toBe(10);
  });

  it("目前值超出範圍或不是數字：拉回範圍內（999 號在 57 席的排 → 57；空白 → 1）", () => {
    expect(stepValue(999, -1, 57)).toBe(57);
    expect(stepValue(999, 1, 57)).toBe(57);
    expect(stepValue(Number.NaN, 1, 57)).toBe(1);
  });

  it("上限未知（排號不合法時席數是 null）：只限制下限", () => {
    expect(stepValue(3, 1, null)).toBe(4);
    expect(stepValue(1, -1, null)).toBe(1);
  });
});

describe("toSearch：寫回網址，與 parseSeatQuery 互逆", () => {
  it("網址不再寫 mode=；只有鳥瞰除錯時加上 debug=overview", () => {
    const seat = toSearch(dome("baseball", "I1-HP", 1, 29));
    expect(seat).not.toContain("mode=");
    expect(seat).not.toContain("debug=");
    const overview = toSearch(dome("baseball", "I1-HP", 1, 29, "overview"));
    expect(overview).not.toContain("mode=");
    expect(overview).toContain("debug=overview");
  });

  it.each([
    dome("baseball", "I1-HP", 1, 29),
    dome("concert", "F1", 20, 100, "overview"),
    { venueId: "demo-arena", layoutId: "concert", sectionId: "A1", row: 1, seat: 16, mode: "seat" } satisfies Selection,
  ])("%o", (selection) => {
    const search = toSearch(selection);
    expect(search.startsWith("?")).toBe(true);
    expect(parseSeatQuery(search)).toEqual(selection);
  });
});
