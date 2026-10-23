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
  ])("%s／%s：區數 = 這個 layout 開放的區，順序相同", (venueId, layoutId) => {
    const venue = parseVenue(venueId === "taipei-dome" ? taipeiDomeJson : demoArenaJson);
    const model = buildMinimapModel(venue, layoutId, null);
    expect(model.sections.map((s) => s.id)).toEqual(listSections(venue, layoutId).map((s) => s.id));
  });

  it("演唱會沒有舞台後方的 136、137、140、141；棒球有", () => {
    const concert = buildMinimapModel(dome(), "concert", null).sections.map((s) => s.id);
    const baseball = buildMinimapModel(dome(), "baseball", null).sections.map((s) => s.id);
    for (const id of ["136", "137", "140", "141"]) {
      expect(concert, id).not.toContain(id);
      expect(baseball, id).toContain(id);
    }
  });

  it("每個區的輪廓都閉合：SVG path 以 M 開頭、Z 結尾，至少 4 個頂點", () => {
    for (const section of buildMinimapModel(dome(), "baseball", null).sections) {
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
    const upper = sections.find((s) => s.id === "212");
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
