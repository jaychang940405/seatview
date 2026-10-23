import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../../scripts/outline.ts";
import { parseVenue } from "../core/schema";
import { listSections } from "../core/view";
import demoArenaJson from "../venues/demo-arena.json";
import taipeiDomeJson from "../venues/taipei-dome.json";
import { buildMinimapModel } from "./minimap";

const dome = () => parseVenue(taipeiDomeJson);

describe("buildMinimapModel：小地圖（取代鳥瞰的選位功能）", () => {
  it.each([
    ["taipei-dome", "baseball"],
    ["taipei-dome", "concert"],
    ["demo-arena", "concert"],
    ["demo-arena", "baseball"],
  ])("%s／%s：每一層畫出來的區合起來 = 這個 layout 開放的區，順序相同", (venueId, layoutId) => {
    const venue = parseVenue(venueId === "taipei-dome" ? taipeiDomeJson : demoArenaJson);
    const { levels } = buildMinimapModel(venue, layoutId, null);
    const drawn = new Set((levels.length > 0 ? levels : [null]).flatMap((level) => buildMinimapModel(venue, layoutId, null, level).sections.map((s) => s.id)));
    const open = listSections(venue, layoutId).map((s) => s.id);
    expect([...drawn].sort()).toEqual([...open].sort());
    for (const level of levels) {
      const ids = buildMinimapModel(venue, layoutId, null, level).sections.map((s) => s.id);
      expect(ids, level).toEqual(open.filter((id) => ids.includes(id)));
    }
  });

  it("演唱會沒有舞台後方的 136、137、140、141（都在 B1）；棒球有", () => {
    const concert = buildMinimapModel(dome(), "concert", null).sections.map((s) => s.id);
    const baseball = buildMinimapModel(dome(), "baseball", null).sections.map((s) => s.id);
    for (const id of ["136", "137", "140", "141"]) {
      expect(concert, id).not.toContain(id);
      expect(baseball, id).toContain(id);
    }
  });

  it("每個區的輪廓都閉合：SVG path 以 M 開頭、Z 結尾，至少 4 個頂點（B1、L2 兩層都檢查）", () => {
    for (const section of ["B1", "L2"].flatMap((level) => buildMinimapModel(dome(), "baseball", null, level).sections)) {
      expect(section.points.length, section.id).toBeGreaterThanOrEqual(4);
      expect(section.path, section.id).toMatch(/^M [-\d.]+ [-\d.]+( L [-\d.]+ [-\d.]+)+ Z$/);
    }
  });

  it("選中的座位：點落在對應區的輪廓內（含被外框截短的排：102 第 23 排、201 第 15 排）", () => {
    for (const [sectionId, row, seat] of [
      ["113", 38, 7],
      ["105", 15, 11],
      ["102", 23, 32],
      ["201", 15, 15],
      ["212", 19, 6],
      ["140", 14, 12],
    ] as const) {
      const model = buildMinimapModel(dome(), "baseball", { sectionId, row, seat });
      const section = model.sections.find((s) => s.id === sectionId);
      expect(model.selected?.sectionId).toBe(sectionId);
      expect(section && model.selected && pointInPolygon(section.points, model.selected.point), sectionId).toBe(true);
    }
  });

  it("座位不合法，或這個 layout 沒開放那一區 → 沒有選中點", () => {
    expect(buildMinimapModel(dome(), "baseball", { sectionId: "113", row: 99, seat: 1 }).selected).toBeNull();
    expect(buildMinimapModel(dome(), "concert", { sectionId: "140", row: 1, seat: 1 }).selected).toBeNull();
  });

  it("點一區 → 跳到中央座位：排取中間，號取那一排的中間（113 有 38 排 → 第 19 排；212 有 19 排 → 第 10 排）", () => {
    const sections = buildMinimapModel(dome(), "baseball", null).sections;
    const seatsPerRow = (id: string) => listSections(dome(), "baseball").find((s) => s.id === id)?.seatsPerRow ?? [];
    const lower = sections.find((s) => s.id === "113");
    expect(lower?.target).toEqual({ row: 19, seat: Math.ceil((seatsPerRow("113")[18] ?? 0) / 2) });
    const upper = buildMinimapModel(dome(), "baseball", null, "L2").sections.find((s) => s.id === "212");
    expect(upper?.target).toEqual({ row: 10, seat: Math.ceil((seatsPerRow("212")[9] ?? 0) / 2) });
  });

  it("viewBox 包住所有區的輪廓（含邊距）", () => {
    const model = buildMinimapModel(dome(), "baseball", null);
    const [minX, minZ, width, height] = model.viewBox.split(" ").map(Number) as [number, number, number, number];
    for (const p of model.sections.flatMap((s) => s.points)) {
      expect(p.x).toBeGreaterThan(minX);
      expect(p.x).toBeLessThan(minX + width);
      expect(p.z).toBeGreaterThan(minZ);
      expect(p.z).toBeLessThan(minZ + height);
    }
  });

  it("附上 layout 的線條（界外線、外野牆）當方位參考", () => {
    const ids = buildMinimapModel(dome(), "baseball", null).lines.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["foul-line-left", "foul-line-right", "outfield-wall"]));
  });
});

describe("buildMinimapModel：樓層圖層（L2 懸挑在 B1 後段上方，平面上會重疊，所以一次只畫一層）", () => {
  const ids = (model: ReturnType<typeof buildMinimapModel>) => model.sections.map((s) => s.id);

  it("大巨蛋有 B1、L2 兩層（依資料順序）；示範場館沒有樓層 → 不分圖層、全部都畫", () => {
    expect(buildMinimapModel(dome(), "baseball", null).levels).toEqual(["B1", "L2"]);
    const demo = buildMinimapModel(parseVenue(demoArenaJson), "concert", null);
    expect(demo.levels).toEqual([]);
    expect(demo.level).toBeNull();
    expect(ids(demo)).toEqual(["A1", "B1", "F1"]);
  });

  it("沒指定圖層時跟著選中的區：212 → L2、113 → B1；沒有選中的區 → 第一層", () => {
    expect(buildMinimapModel(dome(), "baseball", { sectionId: "212", row: 7, seat: 5 }).level).toBe("L2");
    expect(buildMinimapModel(dome(), "baseball", { sectionId: "113", row: 38, seat: 7 }).level).toBe("B1");
    expect(buildMinimapModel(dome(), "baseball", null).level).toBe("B1");
  });

  it("只畫這一層的區；沒有樓層的區（演唱會搖滾區）每一層都畫", () => {
    const l2 = buildMinimapModel(dome(), "concert", null, "L2");
    expect(ids(l2).filter((id) => !id.startsWith("F")).every((id) => id.startsWith("2"))).toBe(true);
    expect(ids(l2)).toEqual(expect.arrayContaining(["201", "225", "F1", "F2", "F3"]));
    const b1 = buildMinimapModel(dome(), "concert", null, "B1");
    expect(ids(b1).some((id) => id.startsWith("2"))).toBe(false);
    expect(ids(b1)).toEqual(expect.arrayContaining(["102", "146", "F1"]));
  });

  it("指定的圖層優先於選中的區；選中的區不在這一層 → 不畫選中點", () => {
    const model = buildMinimapModel(dome(), "baseball", { sectionId: "113", row: 38, seat: 7 }, "L2");
    expect(model.level).toBe("L2");
    expect(model.selected).toBeNull();
  });

  it("不存在的圖層 → 當作沒指定", () => {
    expect(buildMinimapModel(dome(), "baseball", { sectionId: "212", row: 7, seat: 5 }, "L9").level).toBe("L2");
  });

  it("切換圖層時 viewBox 不變（畫面不會跳）", () => {
    expect(buildMinimapModel(dome(), "baseball", null, "L2").viewBox).toBe(buildMinimapModel(dome(), "baseball", null, "B1").viewBox);
  });
});
