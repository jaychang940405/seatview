import { describe, expect, it } from "vitest";
import type { Overlay, PlanPoint, Vec3, Venue } from "../core/schema";
import { parseVenue } from "../core/schema";
import { sectionSeats, seatPosition } from "../core/seat";
import { getSeatView, listSections } from "../core/view";
import { expectSeatError } from "../test/helpers";
import { pointInPolygon, signedDistance, superellipsePolygon } from "../../scripts/outline.ts";
import { K } from "../../scripts/taipei-dome-model.ts";
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
const INFIELD_ARC = 28.96; // 內野紅土弧半徑 95 呎（規則值；外觀用）
const HOME_CIRCLE = 3.96; // 本壘圓半徑 13 呎（A）
const MOUND = { diameter: 5.49, height: 0.254 }; // 投手丘 18 呎、10 吋（A）
const WARNING_TRACK = 4.5; // 警戒區寬（C）

// 作業指令的規格
const SECTION_IDS = ["I1-1B", "I1-HP", "I1-3B", "I2-1B", "I2-HP", "I2-3B", "O1-RF", "O1-CF", "O1-LF", "F1", "F2", "F3"];
const I1 = ["I1-1B", "I1-HP", "I1-3B"];
const I2 = ["I2-1B", "I2-HP", "I2-3B"];
const O1 = ["O1-RF", "O1-CF", "O1-LF"];
const SEAT_SPACING = { min: 0.45, max: 0.65 };
const WALL_CLEARANCE = 3;
const HEADROOM = 2.5; // 上下兩層座位之間的垂直淨空門檻（C）
const ROOF_HEIGHT = 74.5; // 球場面到屋頂外側：地面以上 64 m（OSM）＋地下 10.5 m（B，TVBS）；室內淨高 72 m
const MAX_LOWER_ROWS = 30; // 一層排數的經驗上限（C，不是量測值）
// 外框摘要：OSM 圓頂分件（way 1304278778）兩種本壘方位交集的內接超橢圓，最大內縮差距 0.95 m。
// 資料 © OpenStreetMap contributors（ODbL）；C 級。形狀寫死在這裡，擺放位置是建模選擇，讀 K.outlinePlacement。
const OUTLINE_SHAPE = { semiAxisX: 79.84, semiAxisZ: 102.52, exponent: 2.5, rotationDeg: 6.25 };
const OUTLINE_MARGIN = 3;
// 席數錨點（B 級推算）：不超過 +10%（不誇大容量）；寬鬆下限只當回歸保護
const SEAT_ANCHORS = {
  lower: { anchor: 17000, min: 17000 * 0.75, max: 17000 * 1.1 },
  upper: { anchor: 4700, min: 4700 * 0.9, max: 4700 * 1.1 },
};

// 每個測試各自 parse：資料是空殼或壞掉時，每個案例各自失敗
const dome = () => parseVenue(taipeiDomeJson);

const planDistance = (a: PlanPoint, b: PlanPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const distance3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function overlay(venue: Venue, layoutId: string, id: string): Overlay {
  const found = venue.layouts[layoutId]?.overlays?.find((o) => o.id === id);
  if (!found) throw new Error(`${layoutId} 沒有 overlay ${id}`);
  return found;
}

function polygon(venue: Venue, id: string): Extract<Overlay, { type: "polygon" }> {
  const found = overlay(venue, "baseball", id);
  if (found.type !== "polygon") throw new Error(`${id} 不是 polygon`);
  return found;
}

const centroid = (points: PlanPoint[]): PlanPoint => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  z: points.reduce((sum, p) => sum + p.z, 0) / points.length,
});

/** 從本壘看，偏離本壘–中外野軸線的角度（度，一壘側為正）；界內是 ±45° 以內。 */
const angleFromCenterLine = (p: PlanPoint) => (Math.atan2(p.x - PLATE.x, PLATE.z - p.z) * 180) / Math.PI;

/** 外野牆圓弧：通過兩根界外桿與中外野（只用 B 級的 335 呎、400 呎推出來）。 */
function outfieldWallCircle(): { center: PlanPoint; radius: number } {
  const pole = { x: FOUL_POLE * Math.SQRT1_2, z: PLATE.z - FOUL_POLE * Math.SQRT1_2 };
  const centerField = PLATE.z - CENTER_FIELD;
  // 圓心在 x = 0 上：到中外野與到界外桿等距
  const zc = (pole.x ** 2 + pole.z ** 2 - centerField ** 2) / (2 * (pole.z - centerField));
  return { center: { x: 0, z: zc }, radius: Math.abs(centerField - zc) };
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

  it("外野牆兩端（左右桿）距本壘 102.11 ± 0.1 m，界外線從本壘出發", () => {
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

  it("界外線終點 = 外野牆端點（座標相等），左右沒有接反", () => {
    const venue = dome();
    const wall = polyline(venue, "outfield-wall");
    const leftEnd = polyline(venue, "foul-line-left").at(-1);
    const rightEnd = polyline(venue, "foul-line-right").at(-1);
    // 外野牆從左外野桿畫到右外野桿；三壘側在 −x、一壘側在 +x
    expect(leftEnd).toEqual(wall[0]);
    expect(rightEnd).toEqual(wall.at(-1));
    expect(leftEnd?.x).toBeLessThan(0);
    expect(rightEnd?.x).toBeGreaterThan(0);
  });

  it("一壘、三壘落在界外線上（內野菱形的本壘頂點就在兩條界外線的交點）", () => {
    const venue = dome();
    const [plate, first, , third] = polyline(venue, "infield");
    const onLine = (p: PlanPoint | undefined, end: PlanPoint | undefined) => {
      if (!p || !end || !plate) return NaN;
      const dx = end.x - plate.x, dz = end.z - plate.z;
      return Math.abs((p.x - plate.x) * dz - (p.z - plate.z) * dx) / Math.hypot(dx, dz);
    };
    expect(onLine(first, polyline(venue, "foul-line-right").at(-1))).toBeLessThan(0.01);
    expect(onLine(third, polyline(venue, "foul-line-left").at(-1))).toBeLessThan(0.01);
    expect(first?.x).toBeGreaterThan(0);
    expect(third?.x).toBeLessThan(0);
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
    // 投手丘從方塊改成圓形 polygon；中心 = 頂點平均（正多邊形的中心）
    expectWithin(planDistance(centroid(polygon(dome(), "mound").points), PLATE), PLATE_TO_PITCHER, 0.01);
  });
});

describe("taipei-dome：球場地面（baseball 的 polygon overlays）", () => {
  const polygons = () => (dome().layouts.baseball?.overlays ?? []).filter((o) => o.type === "polygon");
  const pitcher = { x: PLATE.x, z: PLATE.z - PLATE_TO_PITCHER };

  it("七層地面，由下往上：界外地紅土、界內草皮、警戒區、內野紅土、內野草皮、本壘圓、投手丘", () => {
    expect(polygons().map((o) => o.id)).toEqual(["field-dirt", "fair-grass", "warning-track", "infield-dirt", "infield-grass", "home-circle", "mound"]);
  });

  it("每個 polygon 的頂點與高度都是有限數", () => {
    for (const o of polygons()) {
      if (o.type !== "polygon") continue;
      expect(o.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)), o.id).toBe(true);
      expect(Number.isFinite(o.y ?? 0), o.id).toBe(true);
    }
  });

  it("界內草皮在外野牆內、界外線內側（容差 1 cm）", () => {
    const wall = outfieldWallCircle();
    for (const p of polygon(dome(), "fair-grass").points) {
      expect(planDistance(p, wall.center), `(${p.x}, ${p.z})`).toBeLessThanOrEqual(wall.radius + 0.01);
      // 超出界外線的距離：相對本壘 (dx, dz)，界外線是 |dx| = dz
      const [dx, dz] = [p.x - PLATE.x, PLATE.z - p.z];
      expect((Math.abs(dx) - dz) / Math.SQRT2, `(${p.x}, ${p.z})`).toBeLessThanOrEqual(0.01);
    }
  });

  it(`內野紅土：以投手板為圓心、半徑 ${INFIELD_ARC} m（95 呎）的弧，兩端落在界外線上`, () => {
    const [first, ...arc] = polygon(dome(), "infield-dirt").points;
    expect(first).toEqual(PLATE);
    for (const p of arc) expectWithin(planDistance(p, pitcher), INFIELD_ARC, 0.01);
    expectWithin(Math.abs(angleFromCenterLine(arc[0] ?? PLATE)), 45, 0.01);
    expectWithin(Math.abs(angleFromCenterLine(arc.at(-1) ?? PLATE)), 45, 0.01);
  });

  it(`警戒區寬 ${WARNING_TRACK} m：外緣在外野牆上、內緣離牆 ${WARNING_TRACK} m`, () => {
    const wall = outfieldWallCircle();
    const radii = polygon(dome(), "warning-track").points.map((p) => planDistance(p, wall.center));
    for (const r of radii) {
      const onWall = Math.abs(r - wall.radius) <= 0.01;
      const onInner = Math.abs(r - (wall.radius - WARNING_TRACK)) <= 0.01;
      expect(onWall || onInner, `半徑 ${r}`).toBe(true);
    }
  });

  it(`本壘圓：圓心在本壘、半徑 ${HOME_CIRCLE} m（13 呎）`, () => {
    for (const p of polygon(dome(), "home-circle").points) expectWithin(planDistance(p, PLATE), HOME_CIRCLE, 0.01);
  });

  it(`投手丘：圓形、直徑 ${MOUND.diameter} m、高 ${MOUND.height} m（A），從地面長到頂面`, () => {
    const mound = polygon(dome(), "mound");
    const center = centroid(mound.points);
    for (const p of mound.points) expectWithin(planDistance(p, center), MOUND.diameter / 2, 0.01);
    expect(mound.y).toBeCloseTo(MOUND.height, 6);
    expect(mound.height).toBeCloseTo(MOUND.height, 6);
  });

  it("線條畫在平面地面之上：界外線、內野線、外野牆的 y 都高於每一層平面 polygon", () => {
    const flatTop = Math.max(...polygons().flatMap((o) => (o.type === "polygon" && o.height === undefined ? [o.y ?? 0] : [])));
    for (const id of ["foul-line-left", "foul-line-right", "infield", "outfield-wall"]) {
      const line = overlay(dome(), "baseball", id);
      expect(line.type === "polyline" ? (line.y ?? 0) : Number.NaN, id).toBeGreaterThan(flatTop);
    }
  });
});

describe("taipei-dome：席數（B 級推算的錨點）", () => {
  it("一層（內野一層 + 外野一層）不超過 17,000 + 10%；下限 −25% 只當回歸保護", () => {
    const count = seatCount(dome(), [...I1, ...O1]);
    expect(count).toBeLessThanOrEqual(SEAT_ANCHORS.lower.max);
    expect(count).toBeGreaterThanOrEqual(SEAT_ANCHORS.lower.min);
  });

  it("二層（內野二層）不超過 4,700 + 10%；下限 −10%", () => {
    const count = seatCount(dome(), I2);
    expect(count).toBeLessThanOrEqual(SEAT_ANCHORS.upper.max);
    expect(count).toBeGreaterThanOrEqual(SEAT_ANCHORS.upper.min);
  });

  it("baseball 開放的座位 = 一層 + 二層（沒有漏算或重複算）", () => {
    const venue = dome();
    const total = listSections(venue, "baseball").reduce((sum, s) => sum + s.seatsPerRow.reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(seatCount(venue, [...I1, ...I2, ...O1]));
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

  // 平面太近「而且」垂直淨空不足才算重疊：允許二層懸挑在一層上方。
  // 不用 3D 距離，因為兩個看台在平面上重疊時，排的高度可能只錯開一點（例：舊版 I1 與 O1 同半徑處差約 0.8 m），
  // 3D 距離看起來夠遠，實際上卻是兩座看台撞在一起。
  it("不同區的座位不重疊：平面距離 < 0.45 m 且垂直淨空 < 2.5 m 才算重疊（0.5 m 格點雜湊，避免 O(n²)）", () => {
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
              if (
                a.sectionId !== b.sectionId &&
                planDistance(a.position, b.position) < SEAT_SPACING.min &&
                Math.abs(a.position.y - b.position.y) < HEADROOM
              ) {
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

  it("穹頂外殼：室內最高 72 m（≤ 屋頂外側 74.5 m）、牆頂 38 m 高於最高的座椅；所有座位在底面輪廓內", () => {
    const venue = dome();
    const shell = venue.shell;
    if (!shell) throw new Error("沒有 shell");
    expect(shell.roofHeight).toBe(72);
    expect(shell.roofHeight).toBeLessThanOrEqual(ROOF_HEIGHT);
    expect(shell.wallHeight).toBe(38);
    const outside = venue.sections.flatMap((s) => sectionSeats(venue, s.id).filter((seat) => !pointInPolygon(shell.outline, seat.position)));
    expect(outside).toHaveLength(0);
    const topSeat = Math.max(...venue.sections.flatMap((s) => sectionSeats(venue, s.id).map((seat) => seat.position.y)));
    expect(topSeat + 1).toBeLessThan(shell.wallHeight);
  });

  it("看台下方結構：二層 I2-* 是懸挑樓板（tier），其他區用預設的實心（solid）", () => {
    for (const section of dome().sections) {
      expect(section.structure, section.id).toBe(I2.includes(section.id) ? "tier" : undefined);
    }
  });

  it("二層 baseHeight ≥ 一層最後一排高度 + 2.5 m", () => {
    const venue = dome();
    const lowerTop = Math.max(...I1.flatMap((id) => sectionSeats(venue, id).map((p) => p.position.y)));
    for (const section of venue.sections.filter((s) => I2.includes(s.id))) {
      expect(section.baseHeight, section.id).toBeGreaterThanOrEqual(lowerTop + HEADROOM);
    }
  });

  it("最高的座位低於屋頂（74.5 m）減淨空 2.5 m", () => {
    const venue = dome();
    const highest = Math.max(...venue.sections.flatMap((s) => sectionSeats(venue, s.id).map((p) => p.position.y)));
    expect(highest).toBeLessThan(ROOF_HEIGHT - HEADROOM);
  });

  it("產生器用的外框形狀 = 這裡寫死的 OSM 摘要", () => {
    expect(K.outline.value).toEqual(OUTLINE_SHAPE);
  });

  it("所有座位都在外框摘要內，且離外框 ≥ 3 m（外圈留空）", () => {
    const venue = dome();
    const outline = superellipsePolygon({ center: K.outlinePlacement.value, ...OUTLINE_SHAPE }, 1);
    let tightest = { clearance: Infinity, id: "" };
    for (const { id } of venue.sections) {
      for (const { position } of sectionSeats(venue, id)) {
        const clearance = signedDistance(outline, position);
        if (clearance < tightest.clearance) tightest = { clearance, id };
      }
    }
    expect(tightest.clearance, `最貼近外框的是 ${tightest.id}`).toBeGreaterThanOrEqual(OUTLINE_MARGIN);
  });

  it("一層每區不超過 30 排（C 級經驗上限）", () => {
    for (const section of dome().sections.filter((s) => [...I1, ...O1].includes(s.id))) {
      expect(section.rows, section.id).toBeLessThanOrEqual(MAX_LOWER_ROWS);
    }
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

  it("內野二層：I2-1B 全部 > 0、I2-3B 全部 < 0、I2-HP 第 1 排中央座位 ≈ 0", () => {
    const venue = dome();
    for (const deg of horizontalDegs(venue, "baseball", "I2-1B")) expect(deg).toBeGreaterThan(0);
    for (const deg of horizontalDegs(venue, "baseball", "I2-3B")) expect(deg).toBeLessThan(0);
    expectCentered(venue, "baseball", "I2-HP", 1);
  });

  it("中外野 O1-CF 所有座位 |角度| ≥ 150°", () => {
    for (const deg of horizontalDegs(dome(), "baseball", "O1-CF")) expect(Math.abs(deg)).toBeGreaterThanOrEqual(150);
  });

  it("中外野 O1-CF 每一排的中央座位 ≈ 180° ± 5°（偶數席時最中間兩席）", () => {
    const venue = dome();
    const section = venue.sections.find((s) => s.id === "O1-CF");
    for (let row = 1; row <= (section?.rows ?? 0); row++) {
      const count = sectionSeats(venue, "O1-CF").filter((p) => p.row === row).length;
      const middle = count % 2 === 1 ? [(count + 1) / 2] : [count / 2, count / 2 + 1];
      for (const seat of middle) {
        // ±180° 是同一個方向，所以用 |角度| ≥ 175° 表示落在 180° ± 5° 內
        const deg = getSeatView(venue, "baseball", "O1-CF", row, seat).metrics.horizontalDeg;
        expect(Math.abs(deg), `第 ${row} 排 ${seat} 號：${deg.toFixed(2)}°`).toBeGreaterThanOrEqual(175);
      }
    }
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
