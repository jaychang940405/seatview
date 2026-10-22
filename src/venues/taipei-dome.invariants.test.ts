import { describe, expect, it } from "vitest";
import type { Overlay, PlanPoint, Vec3, Venue } from "../core/schema";
import { parseVenue } from "../core/schema";
import { sectionSeats, seatPosition } from "../core/seat";
import { getSeatView, listSections } from "../core/view";
import { expectSeatError } from "../test/helpers";
import taipeiDomeJson from "./taipei-dome.json";

/*
 * 臺北大巨蛋近似模型的不變量。
 * 期望值只來自 A／B 級常數（棒球規則、新聞報導）與作業指令的第 3、4 節，
 * 不從產生出來的資料反推；資料跟這裡衝突時改資料，不改這裡。
 */

// A／B 級常數（m）
const PLATE: PlanPoint = { x: 0, z: 60.95 }; // 原點 = 本壘到中外野牆連線的中點
const CENTER_FIELD = 121.92; // 400 呎（B）
const FOUL_POLE = 102.11; // 335 呎（B）
const BASE_PATH = 27.43; // 90 呎（A）
const PLATE_TO_PITCHER = 18.44; // 60 呎 6 吋（A）
const PLATE_TO_SECOND = 38.8; // A

// 作業指令的規格
const SECTION_IDS = ["I1-1B", "I1-HP", "I1-3B", "I2-1B", "I2-HP", "I2-3B", "O1-RF", "O1-CF", "O1-LF", "F1", "F2", "F3"];
const I1 = ["I1-1B", "I1-HP", "I1-3B"];
const I2 = ["I2-1B", "I2-HP", "I2-3B"];
const O1 = ["O1-RF", "O1-CF", "O1-LF"];
const SEAT_SPACING = { min: 0.45, max: 0.65 };
const WALL_CLEARANCE = 3;

// 每個測試各自 parse：資料是空殼或壞掉時，每個案例各自失敗
const dome = () => parseVenue(taipeiDomeJson);

const planDistance = (a: PlanPoint, b: PlanPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const distance3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function overlay(venue: Venue, layoutId: string, id: string): Overlay {
  const found = venue.layouts[layoutId]?.overlays?.find((o) => o.id === id);
  if (!found) throw new Error(`${layoutId} 沒有 overlay ${id}`);
  return found;
}

function polyline(venue: Venue, id: string): PlanPoint[] {
  const found = overlay(venue, "baseball", id);
  if (found.type !== "polyline") throw new Error(`${id} 不是 polyline`);
  return found.points;
}

function seatCount(venue: Venue, ids: string[]): number {
  return ids.reduce((sum, id) => sum + sectionSeats(venue, id).length, 0);
}

function expectWithin(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected), `${actual} 應在 ${expected} ± ${tolerance}`).toBeLessThanOrEqual(tolerance);
}

function horizontalDegs(venue: Venue, layoutId: string, sectionId: string): number[] {
  return sectionSeats(venue, sectionId).map(
    ({ row, seat }) => getSeatView(venue, layoutId, sectionId, row, seat).metrics.horizontalDeg,
  );
}

/**
 * 某排中央座位的水平偏角接近 0。
 * 座位數為偶數時沒有正中那一席，最中間兩席各偏離中線半個座位寬，所以檢查：
 * 兩席左右對稱，且偏角不超過「最大允許間距的一半」在該距離下張開的角度。
 */
function expectCentered(venue: Venue, layoutId: string, sectionId: string, row: number): void {
  const count = sectionSeats(venue, sectionId).filter((p) => p.row === row).length;
  const middle = count % 2 === 1 ? [(count + 1) / 2] : [count / 2, count / 2 + 1];
  const views = middle.map((seat) => getSeatView(venue, layoutId, sectionId, row, seat));
  const sum = views.reduce((s, v) => s + v.metrics.horizontalDeg, 0);
  expect(sum).toBeCloseTo(0, 6);
  for (const view of views) {
    const bound = (Math.atan(SEAT_SPACING.max / 2 / view.metrics.horizontalDistance) * 180) / Math.PI;
    expect(Math.abs(view.metrics.horizontalDeg)).toBeLessThanOrEqual(bound);
  }
}

describe("taipei-dome：基本結構", () => {
  it("parseVenue 通過，layouts 只有 baseball 與 concert", () => {
    expect(Object.keys(dome().layouts).sort()).toEqual(["baseball", "concert"]);
  });

  it("section id 與作業指令第 3 節一致", () => {
    expect(dome().sections.map((s) => s.id)).toEqual(SECTION_IDS);
  });

  it("meta 帶有免責聲明與數字來源", () => {
    const { meta } = dome();
    expect(meta?.disclaimer).toContain("不應作為購票依據");
    expect(meta?.provenance.length).toBeGreaterThan(0);
  });
});

describe("taipei-dome：球場幾何（baseball overlays）", () => {
  it("本壘板 = baseball focus = 內野第一個頂點", () => {
    const venue = dome();
    const { position } = venue.layouts.baseball?.focus ?? { position: { x: NaN, y: NaN, z: NaN } };
    expectWithin(planDistance(position, PLATE), 0, 1e-6);
    expectWithin(planDistance(polyline(venue, "infield")[0] ?? { x: NaN, z: NaN }, PLATE), 0, 1e-6);
  });

  it("外野牆：最遠點（中外野）距本壘 121.92 ± 0.1 m", () => {
    const wall = polyline(dome(), "outfield-wall");
    expectWithin(Math.max(...wall.map((p) => planDistance(p, PLATE))), CENTER_FIELD, 0.1);
  });

  it("外野牆兩端（左右桿）距本壘 102.11 ± 0.1 m，界外線終點就是桿位", () => {
    const venue = dome();
    const wall = polyline(venue, "outfield-wall");
    for (const pole of [wall[0], wall.at(-1)]) {
      expectWithin(planDistance(pole ?? { x: NaN, z: NaN }, PLATE), FOUL_POLE, 0.1);
    }
    for (const id of ["foul-line-left", "foul-line-right"]) {
      const line = polyline(venue, id);
      expectWithin(planDistance(line[0] ?? { x: NaN, z: NaN }, PLATE), 0, 1e-6);
      expectWithin(planDistance(line.at(-1) ?? { x: NaN, z: NaN }, PLATE), FOUL_POLE, 0.1);
    }
  });

  it("內野：壘間 27.43 ± 0.01 m、本壘到二壘 38.80 ± 0.01 m", () => {
    const infield = polyline(dome(), "infield");
    expect(infield).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      const a = infield[i] ?? { x: NaN, z: NaN };
      const b = infield[(i + 1) % 4] ?? { x: NaN, z: NaN };
      expectWithin(planDistance(a, b), BASE_PATH, 0.01);
    }
    expectWithin(planDistance(infield[0] ?? { x: NaN, z: NaN }, infield[2] ?? { x: NaN, z: NaN }), PLATE_TO_SECOND, 0.01);
  });

  it("本壘到投手丘中心 18.44 ± 0.01 m", () => {
    const mound = overlay(dome(), "baseball", "mound");
    if (mound.type !== "box") throw new Error("mound 不是 box");
    expectWithin(planDistance(mound.center, PLATE), PLATE_TO_PITCHER, 0.01);
  });
});

describe("taipei-dome：席數（B 級推算）", () => {
  it("內野一層 + 外野一層 ≈ 17,000（± 3%）", () => {
    expectWithin(seatCount(dome(), [...I1, ...O1]), 17000, 17000 * 0.03);
  });

  it("內野二層 ≈ 4,700（± 3%）", () => {
    expectWithin(seatCount(dome(), I2), 4700, 4700 * 0.03);
  });

  it("baseball 開放的座位合計 ≈ 21,700（± 3%）", () => {
    const total = listSections(dome(), "baseball").reduce(
      (sum, s) => sum + s.seatsPerRow.reduce((a, b) => a + b, 0),
      0,
    );
    expectWithin(total, 21700, 21700 * 0.03);
  });
});

describe("taipei-dome：座位排列", () => {
  it("每區第 1 排相鄰座位距離在 0.45–0.65 m", () => {
    const venue = dome();
    for (const id of SECTION_IDS) {
      const gap = distance3(seatPosition(venue, id, 1, 1), seatPosition(venue, id, 1, 2));
      expect(gap, id).toBeGreaterThanOrEqual(SEAT_SPACING.min);
      expect(gap, id).toBeLessThanOrEqual(SEAT_SPACING.max);
    }
  });

  // 用平面距離：兩個看台在平面上重疊時，排的高度可能錯開而讓 3D 距離看起來夠遠
  // （例：I1 與 O1 半徑差 2 m，同半徑處 O1 高約 0.8 m）。前提是模型沒有建上層懸挑；
  // 之後若建懸挑，要改成「平面太近且垂直淨空不足」才算重疊。
  it("不同區的座位不重疊：平面上任兩席距離 ≥ 0.45 m（0.5 m 格點雜湊，避免 O(n²)）", () => {
    const venue = dome();
    const CELL = 0.5;
    const grid = new Map<string, { sectionId: string; position: Vec3 }[]>();
    for (const { id } of venue.sections) {
      for (const { position } of sectionSeats(venue, id)) {
        const key = `${Math.floor(position.x / CELL)},${Math.floor(position.z / CELL)}`;
        grid.set(key, [...(grid.get(key) ?? []), { sectionId: id, position }]);
      }
    }

    const overlaps: string[] = [];
    for (const [key, seats] of grid) {
      const [i = 0, k = 0] = key.split(",").map(Number);
      for (let di = -1; di <= 1; di++) {
        for (let dk = -1; dk <= 1; dk++) {
          for (const b of grid.get(`${i + di},${k + dk}`) ?? []) {
            for (const a of seats) {
              if (a.sectionId !== b.sectionId && planDistance(a.position, b.position) < SEAT_SPACING.min) {
                overlaps.push(`${a.sectionId} ↔ ${b.sectionId}`);
              }
            }
          }
        }
      }
    }
    expect([...new Set(overlaps)]).toEqual([]);
  });

  it("每個座位距外野牆任一頂點 ≥ 3 m（平面距離）", () => {
    const venue = dome();
    const wall = polyline(venue, "outfield-wall");
    let closest = Infinity;
    for (const { id } of venue.sections) {
      for (const { position } of sectionSeats(venue, id)) {
        for (const vertex of wall) closest = Math.min(closest, planDistance(position, vertex));
      }
    }
    expect(closest).toBeGreaterThanOrEqual(WALL_CLEARANCE);
  });

  it("內野二層最低的座位高於內野一層最高的座位", () => {
    const venue = dome();
    const heights = (ids: string[]) => ids.flatMap((id) => sectionSeats(venue, id).map((p) => p.position.y));
    expect(Math.min(...heights(I2))).toBeGreaterThan(Math.max(...heights(I1)));
  });
});

describe("taipei-dome：水平偏角正負號（baseball，0° = 本壘正後方）", () => {
  it("一壘側 I1-1B 全部 > 0、三壘側 I1-3B 全部 < 0", () => {
    const venue = dome();
    for (const deg of horizontalDegs(venue, "baseball", "I1-1B")) expect(deg).toBeGreaterThan(0);
    for (const deg of horizontalDegs(venue, "baseball", "I1-3B")) expect(deg).toBeLessThan(0);
  });

  it("本壘後方 I1-HP 第 1 排中央座位 ≈ 0", () => {
    expectCentered(dome(), "baseball", "I1-HP", 1);
  });

  it("中外野 O1-CF 中央座位 |角度| > 170", () => {
    const venue = dome();
    const count = sectionSeats(venue, "O1-CF").filter((p) => p.row === 1).length;
    const seat = Math.ceil(count / 2);
    expect(Math.abs(getSeatView(venue, "baseball", "O1-CF", 1, seat).metrics.horizontalDeg)).toBeGreaterThan(170);
  });

  it("右外野 O1-RF 在 90°–180°、左外野 O1-LF 在 −180°–−90°", () => {
    const venue = dome();
    for (const deg of horizontalDegs(venue, "baseball", "O1-RF")) {
      expect(deg).toBeGreaterThanOrEqual(90);
      expect(deg).toBeLessThanOrEqual(180);
    }
    for (const deg of horizontalDegs(venue, "baseball", "O1-LF")) {
      expect(deg).toBeGreaterThanOrEqual(-180);
      expect(deg).toBeLessThanOrEqual(-90);
    }
  });
});

describe("taipei-dome：演唱會（暫定假設：外野端台）", () => {
  it("中外野 O1-CF 在舞台後方，不開放 → SECTION_NOT_IN_LAYOUT", () => {
    expectSeatError(() => getSeatView(dome(), "concert", "O1-CF", 1, 1), "SECTION_NOT_IN_LAYOUT");
  });

  it("搖滾區只在演唱會：baseball 查詢 F1 → SECTION_NOT_IN_LAYOUT", () => {
    expectSeatError(() => getSeatView(dome(), "baseball", "F1", 1, 1), "SECTION_NOT_IN_LAYOUT");
  });

  it("F1 第 1 排中央座位正對舞台、比 focus 低", () => {
    const venue = dome();
    expectCentered(venue, "concert", "F1", 1);
    expect(getSeatView(venue, "concert", "F1", 1, 50).metrics.heightAboveFocus).toBeLessThan(0);
  });
});
