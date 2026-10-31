import { describe, expect, it } from "vitest";
import { SeatViewError } from "../core/errors";
import { parseVenue } from "../core/schema";
import { getSeatView } from "../core/view";
import demoArenaJson from "../venues/demo-arena.json";
import taipeiDomeJson from "../venues/taipei-dome.json";
import { parseSeatQuery } from "./query";
import { applyChange, normalize, panelOptions, stepValue, toSearch, type Selection } from "./selection";

const VENUES = [parseVenue(demoArenaJson), parseVenue(taipeiDomeJson)];
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
/** 棒球開放的官方票區（138、139、213 沒建） */
const BASEBALL_IDS = [...range(102, 124), ...range(131, 137), ...range(140, 146), ...range(201, 212), ...range(214, 225)];

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
    const options = panelOptions(VENUES, dome("baseball", "113", 38, 7));
    expect(options.venues).toEqual([
      { id: "demo-arena", label: "示範體育館" },
      { id: "taipei-dome", label: "臺北大巨蛋（近似模型）" },
    ]);
    // short 給右上角的場地切換鈕用：名稱裡全形括號之前的部分
    expect(options.layouts).toEqual([
      { id: "baseball", label: "棒球", short: "棒球" },
      { id: "concert", label: "演唱會（暫定假設：外野端台）", short: "演唱會" },
    ]);
    expect(options.sections.map((s) => s.id)).toEqual(BASEBALL_IDS);
    // 官方票區沒有另外的名稱，標籤就是區號；group 是樓層，面板用來分組（optgroup）
    expect(options.sections.find((s) => s.id === "113")).toEqual({ id: "113", label: "113", group: "B1" });
    expect(options.sections.find((s) => s.id === "146")?.group).toBe("B1");
    expect(options.sections.find((s) => s.id === "201")?.group).toBe("L2");
  });

  it("沒有樓層的區不分組：演唱會搖滾區、示範場館", () => {
    const concert = panelOptions(VENUES, dome("concert", "113", 38, 7)).sections;
    expect(concert.find((s) => s.id === "F1")).toEqual({ id: "F1", label: "F1 搖滾區 1（模型分區）" });
  });

  it("名稱已經以代號開頭時不重複代號：demo-arena 的 A1 區 → 「A1 區」，不是「A1 A1 區」", () => {
    const start: Selection = { venueId: "demo-arena", layoutId: "concert", sectionId: "A1", row: 1, seat: 16, mode: "seat" };
    expect(panelOptions(VENUES, start).sections).toEqual([
      { id: "A1", label: "A1 區" },
      { id: "B1", label: "B1 區" },
      { id: "F1", label: "F1 搖滾 A" },
    ]);
  });

  it(`演唱會 layout 有 F1–F3、沒有舞台後方的 136、137、140、141（共 ${BASEBALL_IDS.length - 4 + 3} 區）`, () => {
    const ids = panelOptions(VENUES, dome("concert", "113", 38, 7)).sections.map((s) => s.id);
    expect(ids).toHaveLength(BASEBALL_IDS.length - 4 + 3);
    expect(ids).toEqual(expect.arrayContaining(["F1", "F2", "F3"]));
    for (const id of ["136", "137", "140", "141"]) expect(ids).not.toContain(id);
  });

  it("排數與這一排的席數：113 有 38 排，第 1 排 4 席、第 38 排 12 席", () => {
    expect(panelOptions(VENUES, dome("baseball", "113", 1, 2))).toMatchObject({ rows: 38, seats: 4 });
    expect(panelOptions(VENUES, dome("baseball", "113", 38, 7))).toMatchObject({ rows: 38, seats: 12 });
  });

  it("排號不合法（第 99 排、NaN）→ seats 為 null", () => {
    expect(panelOptions(VENUES, dome("baseball", "113", 99, 1)).seats).toBeNull();
    expect(panelOptions(VENUES, dome("baseball", "113", Number.NaN, 1)).seats).toBeNull();
  });
});

describe("applyChange：換場館", () => {
  it("換到 demo-arena → 第一個 layout、第一區、第 1 排中間那一席（31 席 → 16 號），視角不變", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "140", 5, 10, "overview"), { kind: "venue", venueId: "demo-arena" });
    expect(selection).toEqual({ venueId: "demo-arena", layoutId: "concert", sectionId: "A1", row: 1, seat: 16, mode: "overview" });
    expect(notices).toEqual([]);
  });

  it("換到大巨蛋 → 棒球、102、第 1 排 19 號（37 席的中間）", () => {
    const start: Selection = { venueId: "demo-arena", layoutId: "concert", sectionId: "F1", row: 3, seat: 7, mode: "seat" };
    const { selection, notices } = applyChange(VENUES, start, { kind: "venue", venueId: "taipei-dome" });
    expect(selection).toEqual(dome("baseball", "102", 1, 19));
    expect(notices).toEqual([]);
  });
});

describe("applyChange：換 layout", () => {
  it("目前的區在新 layout 有開放 → 區排號都保留，沒有提示", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "113", 38, 7), { kind: "layout", layoutId: "concert" });
    expect(selection).toEqual(dome("concert", "113", 38, 7));
    expect(notices).toEqual([]);
  });

  it("目前的區在新 layout 沒開放 → 改成新 layout 第一區，並提示改了什麼", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "140", 5, 10), { kind: "layout", layoutId: "concert" });
    expect(selection).toEqual(dome("concert", "102", 5, 10));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("140");
    expect(notices[0]).toContain("102");
    expect(errorCodeOf(selection)).toBeUndefined();
  });
});

describe("applyChange：換區（原本合法的排號才會被修正）", () => {
  it("排號在新區仍合法 → 保留，沒有提示（方便比較不同區的同排同號）", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "105", 15, 10), { kind: "section", sectionId: "121" });
    expect(selection).toEqual(dome("baseball", "121", 15, 10));
    expect(notices).toEqual([]);
  });

  it("新區排數不夠 → 改成最後一排並提示：102 第 25 排 → 201 只有 15 排", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "102", 25, 10), { kind: "section", sectionId: "201" });
    expect(selection).toEqual(dome("baseball", "201", 15, 10));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("1–15");
    expect(errorCodeOf(selection)).toBeUndefined();
  });

  it("新區這一排席數不夠 → 改成最後一號並提示：120 第 30 排 30 號 → 105 只有 27 席", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "120", 30, 30), { kind: "section", sectionId: "105" });
    expect(selection).toEqual(dome("baseball", "105", 30, 27));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("1–27");
    expect(errorCodeOf(selection)).toBeUndefined();
  });
});

describe("applyChange：換排、換號（自己輸入的值不修正）", () => {
  it("換排讓原本合法的號數失效 → 改成這一排最後一號並提示：113 第 38 排 12 號 → 第 1 排只有 4 席", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "113", 38, 12), { kind: "row", row: 1 });
    expect(selection).toEqual(dome("baseball", "113", 1, 4));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("1–4");
  });

  it("自己輸入的排號超出範圍 → 不修正，交給 core 回報 ROW_OUT_OF_RANGE", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "113", 38, 7), { kind: "row", row: 99 });
    expect(selection).toEqual(dome("baseball", "113", 99, 7));
    expect(notices).toEqual([]);
    expect(errorCodeOf(selection)).toBe("ROW_OUT_OF_RANGE");
  });

  it("自己輸入的號數超出範圍 → 不修正，交給 core 回報 SEAT_OUT_OF_RANGE", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "113", 38, 7), { kind: "seat", seat: 999 });
    expect(selection).toEqual(dome("baseball", "113", 38, 999));
    expect(notices).toEqual([]);
    expect(errorCodeOf(selection)).toBe("SEAT_OUT_OF_RANGE");
  });

  it("原本就不合法的號數，換排時也不修正（它不是被連帶影響的）", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "113", 1, 999), { kind: "row", row: 38 });
    expect(selection).toEqual(dome("baseball", "113", 38, 999));
    expect(notices).toEqual([]);
  });

  it("pick（小地圖點選）：一次設定區、排、號，不修正、沒有提示", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "113", 38, 7), { kind: "pick", sectionId: "212", row: 7, seat: 5 });
    expect(selection).toEqual(dome("baseball", "212", 7, 5));
    expect(notices).toEqual([]);
  });

  it("切換視角只改 mode", () => {
    const { selection, notices } = applyChange(VENUES, dome("baseball", "113", 38, 7), { kind: "mode", mode: "overview" });
    expect(selection).toEqual(dome("baseball", "113", 38, 7, "overview"));
    expect(notices).toEqual([]);
  });
});

describe("normalize：處理網址參數", () => {
  it("合法的網址 → 原樣保留，沒有提示", () => {
    const query = parseSeatQuery("?venue=taipei-dome&layout=baseball&section=113&row=38&seat=7&mode=overview");
    expect(normalize(VENUES, query)).toEqual({ selection: query, notices: [] });
  });

  it("網址的排號超出範圍 → 不修正（和自己輸入一樣，交給 core 回報）", () => {
    const query = parseSeatQuery("?venue=taipei-dome&layout=baseball&section=113&row=99&seat=1");
    expect(normalize(VENUES, query)).toEqual({ selection: query, notices: [] });
  });

  it("不認得的場館 → 第一個場館的預設座位，並提示", () => {
    const { selection, notices } = normalize(VENUES, parseSeatQuery("?venue=nope&layout=baseball&section=113"));
    expect(selection).toEqual({ venueId: "demo-arena", layoutId: "concert", sectionId: "A1", row: 1, seat: 16, mode: "seat" });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("nope");
  });

  it("不認得的 layout → 第一個 layout，提示附 UNKNOWN_LAYOUT；區在新 layout 有開放就保留", () => {
    const { selection, notices } = normalize(VENUES, parseSeatQuery("?venue=taipei-dome&layout=opera&section=113&row=38&seat=7"));
    expect(selection).toEqual(dome("baseball", "113", 38, 7));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("UNKNOWN_LAYOUT");
    expect(notices[0]).toContain("opera");
  });

  it("未建模的區（L2 外野 233）→ 這個 layout 的第一區，提示附 UNKNOWN_SECTION", () => {
    const { selection, notices } = normalize(VENUES, parseSeatQuery("?venue=taipei-dome&layout=baseball&section=233&row=1&seat=1"));
    expect(selection).toEqual(dome("baseball", "102", 1, 1));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("UNKNOWN_SECTION");
    expect(notices[0]).toContain("233");
  });

  it("這個 layout 沒開放的區 → 第一區並提示", () => {
    const { selection, notices } = normalize(VENUES, parseSeatQuery("?venue=taipei-dome&layout=concert&section=140&row=5&seat=10"));
    expect(selection).toEqual(dome("concert", "102", 5, 10));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("140");
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
    const seat = toSearch(dome("baseball", "113", 38, 7));
    expect(seat).not.toContain("mode=");
    expect(seat).not.toContain("debug=");
    const overview = toSearch(dome("baseball", "113", 38, 7, "overview"));
    expect(overview).not.toContain("mode=");
    expect(overview).toContain("debug=overview");
  });

  it.each([
    dome("baseball", "113", 38, 7),
    dome("concert", "F1", 20, 100, "overview"),
    { venueId: "demo-arena", layoutId: "concert", sectionId: "A1", row: 1, seat: 16, mode: "seat" } satisfies Selection,
  ])("%o", (selection) => {
    const search = toSearch(selection);
    expect(search.startsWith("?")).toBe(true);
    expect(parseSeatQuery(search)).toEqual(selection);
  });
});
