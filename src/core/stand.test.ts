import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../../scripts/outline.ts";
import { expectSeatError } from "../test/helpers";
import demoArenaJson from "../venues/demo-arena.json";
import taipeiDomeJson from "../venues/taipei-dome.json";
import type { PlanPoint, Section, Venue } from "./schema";
import { parseVenue } from "./schema";
import { sectionSeats } from "./seat";
import { ARC_STEP_DEG, sectionOutline, sectionTreads, TIER_SLAB_THICKNESS } from "./stand";

const VENUES = [parseVenue(demoArenaJson), parseVenue(taipeiDomeJson)];
const ALL_SECTIONS: [Venue, Section][] = VENUES.flatMap((venue) => venue.sections.map((section): [Venue, Section] => [venue, section]));
const dome = () => parseVenue(taipeiDomeJson);
const label = ([venue, section]: [Venue, Section]) => `${venue.id}/${section.id}`;

const planDistance = (a: PlanPoint, b: PlanPoint) => Math.hypot(a.x - b.x, a.z - b.z);

describe("sectionTreads：每一排的踏面", () => {
  it("每排一個踏面，依排號排列；踏面高度 = 這一排座位的地面高度", () => {
    for (const entry of ALL_SECTIONS) {
      const [venue, section] = entry;
      const treads = sectionTreads(venue, section.id);
      expect(treads.map((t) => t.row), label(entry)).toEqual(Array.from({ length: section.rows }, (_, i) => i + 1));
      for (const seat of sectionSeats(venue, section.id)) {
        expect(treads[seat.row - 1]?.top, `${label(entry)} 第 ${seat.row} 排`).toBeCloseTo(seat.position.y, 9);
      }
    }
  });

  it("每一席的平面位置都落在自己那一排的踏面內", () => {
    for (const entry of ALL_SECTIONS) {
      const [venue, section] = entry;
      const treads = sectionTreads(venue, section.id);
      const outside = sectionSeats(venue, section.id).filter((seat) => {
        const tread = treads[seat.row - 1];
        if (!tread) return true;
        return !pointInPolygon([...tread.front, ...[...tread.back].reverse()], seat.position);
      });
      expect(outside.length, `${label(entry)}：${outside.slice(0, 3).map((s) => `${s.row}-${s.seat}`).join("、")}`).toBe(0);
    }
  });

  it("相鄰兩排完全接合：第 r 排的後緣 = 第 r+1 排的前緣", () => {
    for (const entry of ALL_SECTIONS) {
      const [venue, section] = entry;
      const treads = sectionTreads(venue, section.id);
      for (let i = 1; i < treads.length; i++) {
        const back = treads[i - 1]?.back ?? [];
        const front = treads[i]?.front ?? [];
        expect(front.length, label(entry)).toBe(back.length);
        front.forEach((p, k) => expect(planDistance(p, back[k] as PlanPoint), `${label(entry)} 第 ${i} 排`).toBeLessThan(1e-9));
      }
    }
  });

  it("踏面深度 = 排深：前緣與後緣對應點的距離都等於 rowDepth", () => {
    for (const entry of ALL_SECTIONS) {
      const [venue, section] = entry;
      for (const tread of sectionTreads(venue, section.id)) {
        tread.front.forEach((p, k) => expect(planDistance(p, tread.back[k] as PlanPoint), label(entry)).toBeCloseTo(section.rowDepth, 9));
      }
    }
  });

  it(`折線點數：linear 是兩點直線；弧形每段不超過 ${ARC_STEP_DEG}°（I1-HP 跨 90° → 45 段、46 點）`, () => {
    const venue = dome();
    expect(sectionTreads(venue, "I1-1B").every((t) => t.front.length === 2 && t.back.length === 2)).toBe(true);
    expect(sectionTreads(venue, "I1-HP").every((t) => t.front.length === 46 && t.back.length === 46)).toBe(true);
  });

  it("前緣在座位前方（較靠近場地）：弧形區前緣半徑較小，linear 前緣在 facing 那一側", () => {
    const venue = dome();
    const plate = { x: 0, z: 60.95 };
    for (const id of ["I1-HP", "I1-1B", "I1-3B"]) {
      const [first] = sectionTreads(venue, id);
      if (!first) throw new Error(`${id} 沒有踏面`);
      const mid = (points: PlanPoint[]) => ({ x: (points[0]!.x + points.at(-1)!.x) / 2, z: (points[0]!.z + points.at(-1)!.z) / 2 });
      expect(planDistance(mid(first.front), plate), id).toBeLessThan(planDistance(mid(first.back), plate));
    }
  });
});

describe("sectionOutline：區的平面輪廓（給小地圖用）", () => {
  const area = (points: PlanPoint[]) =>
    Math.abs(points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length] as PlanPoint;
      return sum + p.x * q.z - q.x * p.z;
    }, 0)) / 2;

  it("= 第 1 排前緣接最後一排後緣（反向）；不重複起點", () => {
    const venue = dome();
    for (const id of ["I1-HP", "I1-1B", "I2-HP", "F1"]) {
      const treads = sectionTreads(venue, id);
      const outline = sectionOutline(venue, id);
      const first = treads[0];
      const last = treads.at(-1);
      if (!first || !last) throw new Error(`${id} 沒有踏面`);
      expect(outline, id).toEqual([...first.front, ...[...last.back].reverse()]);
    }
  });

  it("每一區的輪廓都包住該區所有座位，而且面積 > 0", () => {
    for (const entry of ALL_SECTIONS) {
      const [venue, section] = entry;
      const outline = sectionOutline(venue, section.id);
      expect(outline.length, label(entry)).toBeGreaterThanOrEqual(4);
      expect(area(outline), label(entry)).toBeGreaterThan(1);
      const outside = sectionSeats(venue, section.id).filter((seat) => !pointInPolygon(outline, seat.position));
      expect(outside.length, label(entry)).toBe(0);
    }
  });

  it("不存在的區 → UNKNOWN_SECTION", () => {
    expectSeatError(() => sectionOutline(dome(), "O2-RF"), "UNKNOWN_SECTION");
  });
});

describe("sectionTreads：底部（看台下方的結構）", () => {
  it("solid（預設）：每一排都實心到地面 0", () => {
    const venue = parseVenue(demoArenaJson);
    expect(sectionTreads(venue, "A1").every((t) => t.bottom === 0)).toBe(true);
    expect(sectionTreads(dome(), "I1-HP").every((t) => t.bottom === 0)).toBe(true);
  });

  it(`tier：底部在前一排踏面下方 ${TIER_SLAB_THICKNESS} m，第 1 排在自己的踏面下方`, () => {
    const treads = sectionTreads(dome(), "I2-HP");
    expect(treads[0]?.bottom).toBeCloseTo((treads[0]?.top ?? Number.NaN) - TIER_SLAB_THICKNESS, 9);
    for (let i = 1; i < treads.length; i++) {
      expect(treads[i]?.bottom).toBeCloseTo((treads[i - 1]?.top ?? Number.NaN) - TIER_SLAB_THICKNESS, 9);
    }
  });

  it("搖滾區（在地面、不升高）：每一排高度都是 0", () => {
    expect(sectionTreads(dome(), "F1").every((t) => t.top === 0 && t.bottom === 0)).toBe(true);
  });

  it("不存在的區 → UNKNOWN_SECTION", () => {
    expectSeatError(() => sectionTreads(dome(), "O2-RF"), "UNKNOWN_SECTION");
  });
});
