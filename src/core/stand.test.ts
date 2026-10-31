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

/** 有 rowSpans 的合成場館：直線區第 1 排用 25%–75%、第 2 排用 0–25%；弧區只用後半。 */
const SPANNED: Venue = parseVenue({
  ...demoArenaJson,
  sections: [
    { id: "SPAN", type: "linear", from: { x: -10, z: 15 }, to: { x: 10, z: 15 }, facing: { x: 0, z: 0 }, rows: 3, seatsPerRow: [20, 10, 10], rowDepth: 1, rowRise: 0.5, baseHeight: 0, rowSpans: [[0.25, 0.75], [0, 0.25], [0, 0.25]] },
    { id: "ARC_SPAN", type: "arc", center: { x: 0, z: 0 }, innerRadius: 20, fromDeg: 60, toDeg: 120, rows: 2, seatsPerRow: [10, 12], rowDepth: 0.8, rowRise: 0.4, baseHeight: 2, rowSpans: [[0.5, 1], [0.4, 1]] },
  ],
  layouts: { concert: { name: "演唱會", focus: { position: { x: 0, y: 3, z: -30 }, facingDeg: 90 } } },
});

/** 平面上的點離區的基準線多遠：arc 是到圓心的距離，linear 是往後方（遠離 facing）的距離。 */
function offsetOf(section: Section, p: PlanPoint): number {
  if (section.type === "arc") return planDistance(p, section.center);
  const [dx, dz] = [section.to.x - section.from.x, section.to.z - section.from.z];
  const length = Math.hypot(dx, dz);
  let [nx, nz] = [-dz / length, dx / length];
  // 法向量指向遠離 facing 的那一側
  if ((section.facing.x - section.from.x) * nx + (section.facing.z - section.from.z) * nz > 0) [nx, nz] = [-nx, -nz];
  return (p.x - section.from.x) * nx + (p.z - section.from.z) * nz;
}

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

  it("相鄰兩排接在同一條線上：第 r 排後緣與第 r+1 排前緣離座位基準線一樣遠；兩排範圍相同時點完全重合", () => {
    for (const entry of [...ALL_SECTIONS, ...SPANNED.sections.map((section): [Venue, Section] => [SPANNED, section])]) {
      const [venue, section] = entry;
      const treads = sectionTreads(venue, section.id);
      for (let i = 1; i < treads.length; i++) {
        const back = treads[i - 1]?.back ?? [];
        const front = treads[i]?.front ?? [];
        const offsets = [...back, ...front].map((p) => offsetOf(section, p));
        for (const o of offsets) expect(o, `${label(entry)} 第 ${i} 排`).toBeCloseTo(offsets[0] ?? Number.NaN, 9);
        const sameSpan = JSON.stringify(section.rowSpans?.[i - 1] ?? [0, 1]) === JSON.stringify(section.rowSpans?.[i] ?? [0, 1]);
        if (sameSpan) front.forEach((p, k) => expect(planDistance(p, back[k] as PlanPoint), `${label(entry)} 第 ${i} 排`).toBeLessThan(1e-9));
      }
    }
  });

  it("rowSpans：每排踏面只畫在那一排的範圍內（第 2 排 0–25% → x = −10…−5）", () => {
    const [, second] = sectionTreads(SPANNED, "SPAN");
    expect(second?.front.map((p) => p.x)).toEqual([-10, -5]);
    expect(second?.back.map((p) => p.x)).toEqual([-10, -5]);
    const [arcRow] = sectionTreads(SPANNED, "ARC_SPAN");
    const angles = (arcRow?.front ?? []).map((p) => (Math.atan2(p.z, p.x) * 180) / Math.PI);
    expect(angles[0]).toBeCloseTo(90, 6);
    expect(angles.at(-1)).toBeCloseTo(120, 6);
  });

  it("踏面深度 = 排深：前緣與後緣對應點的距離都等於 rowDepth", () => {
    for (const entry of ALL_SECTIONS) {
      const [venue, section] = entry;
      for (const tread of sectionTreads(venue, section.id)) {
        tread.front.forEach((p, k) => expect(planDistance(p, tread.back[k] as PlanPoint), label(entry)).toBeCloseTo(section.rowDepth, 9));
      }
    }
  });

  it(`折線點數：linear 是兩點直線（示範場館 B1）；弧形每段不超過 ${ARC_STEP_DEG}°、段數取最少（113 區每排用到 5.7°–6.9° → 3 或 4 段）`, () => {
    const venue = dome();
    expect(sectionTreads(parseVenue(demoArenaJson), "B1").every((t) => t.front.length === 2 && t.back.length === 2)).toBe(true);
    const arc = venue.sections.find((s) => s.id === "113");
    if (arc?.type !== "arc" || !arc.rowSpans) throw new Error("113 區應該是有 rowSpans 的弧形區");
    const sweep = arc.toDeg - arc.fromDeg;
    sectionTreads(venue, "113").forEach((t, i) => {
      const [start, end] = arc.rowSpans?.[i] ?? [0, 1];
      const points = Math.ceil(((end - start) * sweep) / ARC_STEP_DEG) + 1;
      expect([4, 5]).toContain(points);
      expect(t.front.length, `第 ${t.row} 排`).toBe(points);
      expect(t.back.length, `第 ${t.row} 排`).toBe(points);
    });
  });

  it("前緣在座位前方（較靠近場地）：弧形區前緣半徑較小，linear 前緣在 facing 那一側", () => {
    const venue = dome();
    const plate = { x: 0, z: 60.95 };
    for (const id of ["113", "105", "122"]) {
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

  it("沒有 rowSpans 的區：面積 = 第 1 排前緣接最後一排後緣的簡單輪廓", () => {
    for (const entry of ALL_SECTIONS.filter(([, section]) => section.rowSpans === undefined)) {
      const [venue, section] = entry;
      const treads = sectionTreads(venue, section.id);
      const simple = [...(treads[0]?.front ?? []), ...[...(treads.at(-1)?.back ?? [])].reverse()];
      expect(area(sectionOutline(venue, section.id)), label(entry)).toBeCloseTo(area(simple), 6);
    }
  });

  it("有 rowSpans 的區：每一排踏面的兩端都是輪廓的頂點，座位都在輪廓內", () => {
    for (const section of SPANNED.sections) {
      const outline = sectionOutline(SPANNED, section.id);
      for (const tread of sectionTreads(SPANNED, section.id)) {
        for (const p of [tread.front[0], tread.front.at(-1), tread.back[0], tread.back.at(-1)]) {
          expect(outline.some((q) => p && planDistance(p, q) < 1e-9), section.id).toBe(true);
        }
      }
      const outside = sectionSeats(SPANNED, section.id).filter((seat) => !pointInPolygon(outline, seat.position));
      expect(outside, section.id).toEqual([]);
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
    expectSeatError(() => sectionOutline(dome(), "233"), "UNKNOWN_SECTION");
  });
});

describe("sectionTreads：底部（看台下方的結構）", () => {
  it("solid（預設）：每一排都實心到地面 0", () => {
    const venue = parseVenue(demoArenaJson);
    expect(sectionTreads(venue, "A1").every((t) => t.bottom === 0)).toBe(true);
    expect(sectionTreads(dome(), "113").every((t) => t.bottom === 0)).toBe(true);
  });

  it(`tier：底部在前一排踏面下方 ${TIER_SLAB_THICKNESS} m，第 1 排在自己的踏面下方`, () => {
    const treads = sectionTreads(dome(), "212");
    expect(treads[0]?.bottom).toBeCloseTo((treads[0]?.top ?? Number.NaN) - TIER_SLAB_THICKNESS, 9);
    for (let i = 1; i < treads.length; i++) {
      expect(treads[i]?.bottom).toBeCloseTo((treads[i - 1]?.top ?? Number.NaN) - TIER_SLAB_THICKNESS, 9);
    }
  });

  it("搖滾區（在地面、不升高）：每一排高度都是 0", () => {
    expect(sectionTreads(dome(), "F1").every((t) => t.top === 0 && t.bottom === 0)).toBe(true);
  });

  it("不存在的區 → UNKNOWN_SECTION", () => {
    expectSeatError(() => sectionTreads(dome(), "233"), "UNKNOWN_SECTION");
  });
});
