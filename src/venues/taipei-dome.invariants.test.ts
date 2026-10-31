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
const INFIELD_ARC = 28.96; // 內野弧半徑 95 呎（規則值）；大巨蛋是人工草皮，弧只畫成白線
const BASE_CUTOUT = 4.5; // 一壘、三壘紅土方塊邊長（C，依照片目視估計）
const FENCE = { height: 2.5, thickness: 0.3 }; // 全壘打牆（C，依照片目視估計）
const POLE_HEIGHT = 18; // 界外桿高（C，依照片目視估計）
const EYE_HALF_DEG = 5; // 打者之眼：中外野 ±5°（C）
const WALL_HEIGHT = 44; // 穹頂牆頂（C）：L5 示意量體要放得下，從 38 m 調高
const L4_ROWS = 6; // L4 每區只有 6 排（B，NOWnews）；L3、L5 也先用 6 排（C）
const UPPER_FLOOR_GAP = 4; // 上層看台一層疊一層的垂直間距（C）
/** 示意量體：打者之眼、L2 外野、L3–L5 內野（L3 本壘後方是包廂，不畫座位） */
const MASSING = {
  "batters-eye": "B1",
  "upper-L2-outfield-left": "L2",
  "upper-L2-outfield-eye": "L2",
  "upper-L2-outfield-right": "L2",
  "upper-L3-1b": "L3",
  "upper-L3-3b": "L3",
  "upper-L4-1b": "L4",
  "upper-L4-home": "L4",
  "upper-L4-3b": "L4",
  "upper-L5-1b": "L5",
  "upper-L5-home": "L5",
  "upper-L5-3b": "L5",
} as Record<string, string>;
const HOME_CIRCLE = 3.96; // 本壘圓半徑 13 呎（A）
const MOUND = { diameter: 5.49, height: 0.254 }; // 投手丘 18 呎、10 吋（A）
const WARNING_TRACK = 4.5; // 警戒區寬（C）

// 官方票區（區號、層別、相鄰關係、排數下限、票面標籤：B，來源見 docs/venue-taipei-dome.md）
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const B1_INFIELD = range(102, 124);
const B1_OUTFIELD = [...range(131, 137), ...range(140, 146)]; // 138、139 是打者之眼
const L2_INFIELD = [...range(201, 212), ...range(214, 225)]; // 213 在座位圖上是灰色無編號的一塊，不建
const SECTION_IDS = [...B1_INFIELD, ...B1_OUTFIELD, ...L2_INFIELD, "F1", "F2", "F3"];
/** 不建的區：打者之眼、L2 本壘正後方的空位、L2 外野、L3–L5 */
const NOT_BUILT = ["138", "139", "213", "233", "244", "301", "417", "509"];
/** 票面標籤（區、排、號）：模型裡一定要有這一席 */
const TICKET_LABELS: [string, number, number][] = [
  ["113", 38, 7],
  ["102", 23, 32],
  ["103", 38, 9],
  ["115", 38, 9],
  ["133", 14, 6],
  ["142", 9, 34],
  ["201", 15, 15],
  ["203", 18, 26],
  ["205", 19, 10],
];
/** 排數（C，下限來自球迷照片的票面標籤） */
const ROWS = { b1Infield: 38, b1Outfield: 14, l2: { "201": 15, "202": 16, "203": 18 } as Record<string, number>, l2Default: 19 };
/** 一壘側／三壘側（從座位圖讀到的相對位置） */
const FIRST_BASE = { b1: range(102, 112), l2: range(201, 212), outfield: range(140, 146) };
const THIRD_BASE = { b1: range(114, 124), l2: range(214, 225), outfield: range(131, 137) };
/** 演唱會（外野端台）時在舞台正後方、不開放的外野區（C，暫定假設） */
const CONCERT_CLOSED = ["136", "137", "140", "141"];
const SEAT_SPACING = { min: 0.45, max: 0.65 };
const WALL_CLEARANCE = 3;
const HEADROOM = 2.5; // 上下兩層座位之間的垂直淨空門檻（C）
const ROOF_HEIGHT = 74.5; // 球場面到屋頂外側：地面以上 64 m（OSM）＋地下 10.5 m（B，TVBS）；室內淨高 72 m
// 外框摘要：OSM 圓頂分件（way 1304278778）兩種本壘方位交集的內接超橢圓，最大內縮差距 0.95 m。
// 資料 © OpenStreetMap contributors（ODbL）；C 級。形狀寫死在這裡，擺放位置是建模選擇，讀 K.outlinePlacement。
const OUTLINE_SHAPE = { semiAxisX: 79.84, semiAxisZ: 102.52, exponent: 2.5, rotationDeg: 6.25 };
const OUTLINE_MARGIN = 3;
// 層總席數（B−）只在文件裡回報偏差，不當成測試目標：不為了湊數縮放

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

  it("能查詢的 section id = 官方票區（B1 內野、B1 外野、L2 內野）＋演唱會搖滾區（示意量體另外列）", () => {
    expect(dome().sections.filter((s) => s.massing !== true).map((s) => s.id)).toEqual(SECTION_IDS);
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

  it("人工草皮內野，由下往上：界外地紅土、界內草皮、警戒區、一壘與三壘紅土方塊、本壘圓、投手丘（沒有整片內野紅土）", () => {
    expect(polygons().map((o) => o.id)).toEqual(["field-dirt", "fair-grass", "warning-track", "first-base-dirt", "third-base-dirt", "home-circle", "mound"]);
  });

  it(`一壘、三壘紅土方塊：邊長 ${BASE_CUTOUT} m 的正方形，中心在壘包、邊與壘線平行`, () => {
    const venue = dome();
    const [, first, , third] = polyline(venue, "infield");
    for (const [id, base] of [["first-base-dirt", first], ["third-base-dirt", third]] as const) {
      const square = polygon(venue, id).points;
      expect(square, id).toHaveLength(4);
      expectWithin(planDistance(centroid(square), base ?? { x: NaN, z: NaN }), 0, 0.01);
      for (let i = 0; i < 4; i++) {
        const a = square[i] ?? { x: NaN, z: NaN };
        const b = square[(i + 1) % 4] ?? { x: NaN, z: NaN };
        expectWithin(planDistance(a, b), BASE_CUTOUT, 0.01);
        // 壘線方向是 ±45°，所以每條邊的 |dx| = |dz|
        expectWithin(Math.abs(Math.abs(b.x - a.x) - Math.abs(b.z - a.z)), 0, 0.01);
      }
    }
  });

  it("地面材質：界內草皮是 turf，其他紅土圖層（界外地、警戒區、壘包、本壘圓、投手丘）是 dirt", () => {
    const surfaces = Object.fromEntries(polygons().map((o) => [o.id, o.type === "polygon" ? o.surface : undefined]));
    expect(surfaces).toEqual({
      "field-dirt": "dirt",
      "fair-grass": "turf",
      "warning-track": "dirt",
      "first-base-dirt": "dirt",
      "third-base-dirt": "dirt",
      "home-circle": "dirt",
      mound: "dirt",
    });
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

  it(`內野弧是畫在草皮上的白線：以投手板為圓心、半徑 ${INFIELD_ARC} m（95 呎），兩端落在界外線上`, () => {
    const arc = polyline(dome(), "infield-arc");
    expect(arc.length).toBeGreaterThan(2);
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
    for (const id of ["foul-line-left", "foul-line-right", "infield", "infield-arc", "outfield-wall"]) {
      const line = overlay(dome(), "baseball", id);
      expect(line.type === "polyline" ? (line.y ?? 0) : Number.NaN, id).toBeGreaterThan(flatTop);
    }
  });
});

describe("taipei-dome：全壘打牆與界外桿（baseball 的 box overlays）", () => {
  const boxes = (layoutId: string) =>
    (dome().layouts[layoutId]?.overlays ?? []).flatMap((o) => (o.type === "box" ? [o] : []));
  const fence = () => boxes("baseball").filter((o) => o.id.startsWith("outfield-fence-"));
  /** 一段牆在平面上的兩端（沿 yaw 方向各半個長度）。 */
  const ends = (o: ReturnType<typeof fence>[number]) => {
    const yaw = ((o.yawDeg ?? 0) * Math.PI) / 180;
    const half = o.size.x / 2;
    return [
      { x: o.center.x - half * Math.cos(yaw), z: o.center.z - half * Math.sin(yaw) },
      { x: o.center.x + half * Math.cos(yaw), z: o.center.z + half * Math.sin(yaw) },
    ];
  };

  it(`全壘打牆：沿外野牆一段一段、高 ${FENCE.height} m、厚 ${FENCE.thickness} m，從地面立起，緊貼在外野牆外側`, () => {
    const wall = outfieldWallCircle();
    const segments = fence();
    expect(segments.length).toBeGreaterThan(10);
    for (const o of segments) {
      expectWithin(o.size.y, FENCE.height, 1e-6);
      expectWithin(o.size.z, FENCE.thickness, 1e-6);
      expectWithin(o.center.y, FENCE.height / 2, 1e-6);
      const r = planDistance(o.center, wall.center);
      expect(r, o.id).toBeGreaterThanOrEqual(wall.radius);
      expect(r, o.id).toBeLessThanOrEqual(wall.radius + FENCE.thickness);
    }
  });

  it("全壘打牆從左外野桿接到右外野桿，中間沒有缺口", () => {
    const segments = fence().map(ends);
    const leftPole = polyline(dome(), "foul-line-left").at(-1) ?? PLATE;
    const rightPole = polyline(dome(), "foul-line-right").at(-1) ?? PLATE;
    const all = segments.flat();
    expect(Math.min(...all.map((p) => planDistance(p, leftPole)))).toBeLessThan(0.5);
    expect(Math.min(...all.map((p) => planDistance(p, rightPole)))).toBeLessThan(0.5);
    for (let i = 1; i < segments.length; i++) {
      const gap = planDistance(segments[i - 1]?.[1] ?? PLATE, segments[i]?.[0] ?? { x: NaN, z: NaN });
      expect(gap, `第 ${i} 段`).toBeLessThan(0.5);
    }
  });

  it(`界外桿：左右各一根，立在界外線終點，高 ${POLE_HEIGHT} m`, () => {
    for (const [id, line] of [["foul-pole-left", "foul-line-left"], ["foul-pole-right", "foul-line-right"]] as const) {
      const pole = boxes("baseball").find((o) => o.id === id);
      if (!pole) throw new Error(`沒有 ${id}`);
      expectWithin(planDistance(pole.center, polyline(dome(), line).at(-1) ?? PLATE), 0, 0.01);
      expectWithin(pole.size.y, POLE_HEIGHT, 1e-6);
      expectWithin(pole.center.y, POLE_HEIGHT / 2, 1e-6);
    }
  });

  it("演唱會沒有全壘打牆與界外桿", () => {
    expect(boxes("concert").filter((o) => o.id.startsWith("outfield-fence-") || o.id.startsWith("foul-pole-"))).toHaveLength(0);
  });
});

describe("taipei-dome：示意量體（只畫外觀，不能查詢）", () => {
  const massing = () => dome().sections.filter((s) => s.massing === true);

  it("打者之眼 batters-eye：B1 外野中間 ±5° 的深色座位，排數、排距與 B1 外野相同，棒球與演唱會都畫", () => {
    const venue = dome();
    const eye = venue.sections.find((s) => s.id === "batters-eye");
    const outfield = venue.sections.find((s) => s.id === "140");
    if (eye?.type !== "arc" || outfield?.type !== "arc") throw new Error("batters-eye 與 140 都應該是弧形區");
    expect(eye.massing).toBe(true);
    expect(eye.seatColor).toBeDefined();
    expect(eye.layouts).toBeUndefined();
    expectWithin(eye.fromDeg, -90 - EYE_HALF_DEG, 1e-6);
    expectWithin(eye.toDeg, -90 + EYE_HALF_DEG, 1e-6);
    expect(eye.center).toEqual(outfield.center);
    expect(eye.innerRadius).toBe(outfield.innerRadius);
    expect([eye.rows, eye.rowDepth, eye.rowRise, eye.baseHeight]).toEqual([outfield.rows, outfield.rowDepth, outfield.rowRise, outfield.baseHeight]);
  });

  it("示意量體有哪些：打者之眼、L2 外野三段、L3 一三壘側、L4 與 L5 的一三壘側與本壘後方；樓層各自標好", () => {
    const massing = dome().sections.filter((s) => s.massing === true);
    expect(Object.fromEntries(massing.map((s) => [s.id, s.level]))).toEqual(MASSING);
  });

  it(`L3–L5 每層 ${L4_ROWS} 排，都是懸挑樓板；同一層的三段高度相同，上一層比下一層高 ${UPPER_FLOOR_GAP} m`, () => {
    const venue = dome();
    const base = (level: string) => {
      const heights = venue.sections.filter((s) => s.massing && s.level === level).map((s) => s.baseHeight);
      expect(new Set(heights).size, level).toBe(1);
      return heights[0] ?? NaN;
    };
    for (const s of venue.sections.filter((x) => x.massing && /^L[345]$/.test(x.level ?? ""))) {
      expect(s.rows, s.id).toBe(L4_ROWS);
      expect(s.structure, s.id).toBe("tier");
    }
    expectWithin(base("L4") - base("L3"), UPPER_FLOOR_GAP, 1e-6);
    expectWithin(base("L5") - base("L4"), UPPER_FLOOR_GAP, 1e-6);
  });

  it("L2 外野疊在 B1 外野上方：每一席的高度都比 B1 外野最後一排高，是懸挑樓板；中間一段是深色的打者之眼", () => {
    const venue = dome();
    const b1Top = Math.max(...sectionSeats(venue, "140").map((p) => p.position.y));
    for (const id of ["upper-L2-outfield-left", "upper-L2-outfield-eye", "upper-L2-outfield-right"]) {
      expect(Math.min(...sectionSeats(venue, id).map((p) => p.position.y)), id).toBeGreaterThan(b1Top);
      expect(venue.sections.find((s) => s.id === id)?.structure, id).toBe("tier");
    }
    const eye = venue.sections.find((s) => s.id === "upper-L2-outfield-eye");
    expect(eye?.seatColor).toBe(venue.sections.find((s) => s.id === "batters-eye")?.seatColor);
  });

  it("量體的 id 不是官方票區號，查詢一律 UNKNOWN_SECTION（138、139 也還是）", () => {
    expect(massing().length).toBeGreaterThan(0);
    for (const s of massing()) {
      expect(s.id, s.id).not.toMatch(/^\d+$/);
      expectSeatError(() => getSeatView(dome(), "baseball", s.id, 1, 1), "UNKNOWN_SECTION");
    }
  });
});

describe("taipei-dome：官方票區", () => {
  it.each(TICKET_LABELS)("票面標籤 %s 區 %s 排 %s 號存在", (sectionId, row, seat) => {
    expect(() => seatPosition(dome(), sectionId, row, seat)).not.toThrow();
  });

  it("201 區第 15 排剛好 15 席：第 16 號不存在 → SEAT_OUT_OF_RANGE", () => {
    expectSeatError(() => seatPosition(dome(), "201", 15, 16), "SEAT_OUT_OF_RANGE");
  });

  it.each(NOT_BUILT)("沒有建的 %s 區 → UNKNOWN_SECTION", (sectionId) => {
    expectSeatError(() => seatPosition(dome(), sectionId, 1, 1), "UNKNOWN_SECTION");
  });

  it("排數：B1 內野 38、B1 外野 14；L2 的 201、202、203 是 15、16、18，其餘 19", () => {
    const rows = Object.fromEntries(dome().sections.map((s) => [s.id, s.rows]));
    for (const id of B1_INFIELD) expect(rows[id], id).toBe(ROWS.b1Infield);
    for (const id of B1_OUTFIELD) expect(rows[id], id).toBe(ROWS.b1Outfield);
    for (const id of L2_INFIELD) expect(rows[id], id).toBe(ROWS.l2[id] ?? ROWS.l2Default);
  });

  it("baseball 開放的座位 = B1 內野 + B1 外野 + L2 內野（沒有漏算或重複算）", () => {
    const venue = dome();
    const total = listSections(venue, "baseball").reduce((sum, s) => sum + s.seatsPerRow.reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(seatCount(venue, [...B1_INFIELD, ...B1_OUTFIELD, ...L2_INFIELD]));
  });
});

describe("taipei-dome：座位排列", () => {
  it("每區每一排的相鄰座位距離都在 0.45–0.65 m（被牆截短的排也一樣）", () => {
    const venue = dome();
    const bad: string[] = [];
    for (const id of SECTION_IDS) {
      const seats = sectionSeats(venue, id);
      for (let i = 1; i < seats.length; i++) {
        const [a, b] = [seats[i - 1], seats[i]];
        if (!a || !b || a.row !== b.row) continue;
        const gap = distance3(a.position, b.position);
        if (gap < SEAT_SPACING.min || gap > SEAT_SPACING.max) bad.push(`${id} 第 ${a.row} 排 ${a.seat}→${b.seat}：${gap.toFixed(3)} m`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
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

  it(`穹頂外殼：室內最高 72 m（≤ 屋頂外側 74.5 m）、牆頂 ${WALL_HEIGHT} m 高於最高的座椅（含示意量體）；所有座位在底面輪廓內`, () => {
    const venue = dome();
    const shell = venue.shell;
    if (!shell) throw new Error("沒有 shell");
    expect(shell.roofHeight).toBe(72);
    expect(shell.roofHeight).toBeLessThanOrEqual(ROOF_HEIGHT);
    expect(shell.wallHeight).toBe(WALL_HEIGHT);
    const outside = venue.sections.flatMap((s) => sectionSeats(venue, s.id).filter((seat) => !pointInPolygon(shell.outline, seat.position)));
    expect(outside).toHaveLength(0);
    const topSeat = Math.max(...venue.sections.flatMap((s) => sectionSeats(venue, s.id).map((seat) => seat.position.y)));
    expect(topSeat + 1).toBeLessThan(shell.wallHeight);
  });

  it("看台下方結構：L2 內野與上層示意量體是懸挑樓板（tier），其他區用預設的實心（solid）", () => {
    for (const section of dome().sections) {
      const tier = L2_INFIELD.includes(section.id) || section.id.startsWith("upper-");
      expect(section.structure, section.id).toBe(tier ? "tier" : undefined);
    }
  });

  it("樓層 level：B1 內野與外野是 B1、L2 內野是 L2；搖滾區在場地上，不屬於任何樓層", () => {
    for (const section of dome().sections) {
      const expected = MASSING[section.id] ?? (L2_INFIELD.includes(section.id) ? "L2" : section.id.startsWith("F") ? undefined : "B1");
      expect(section.level, section.id).toBe(expected);
    }
  });

  it("L2 baseHeight ≥ B1 內野最後一排高度 + 2.5 m", () => {
    const venue = dome();
    const lowerTop = Math.max(...B1_INFIELD.flatMap((id) => sectionSeats(venue, id).map((p) => p.position.y)));
    for (const section of venue.sections.filter((s) => L2_INFIELD.includes(s.id))) {
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

});

describe("taipei-dome：水平偏角正負號（baseball，0° = 本壘正後方）", () => {
  it("B1 內野：一壘側 102–112 全部 > 0、三壘側 114–124 全部 < 0；本壘正後方 113 第 1 排中央 ≈ 0", () => {
    const venue = dome();
    for (const id of FIRST_BASE.b1) for (const deg of horizontalDegs(venue, "baseball", id)) expect(deg, id).toBeGreaterThan(0);
    for (const id of THIRD_BASE.b1) for (const deg of horizontalDegs(venue, "baseball", id)) expect(deg, id).toBeLessThan(0);
    expectCentered(venue, "baseball", "113", 1);
  });

  it("L2 內野：一壘側 201–212 全部 > 0、三壘側 214–225 全部 < 0", () => {
    const venue = dome();
    for (const id of FIRST_BASE.l2) for (const deg of horizontalDegs(venue, "baseball", id)) expect(deg, id).toBeGreaterThan(0);
    for (const id of THIRD_BASE.l2) for (const deg of horizontalDegs(venue, "baseball", id)) expect(deg, id).toBeLessThan(0);
  });

  it("B1 外野：右外野 140–146 在 90°–180°、左外野 131–137 在 −180°–−90°", () => {
    const venue = dome();
    for (const id of FIRST_BASE.outfield) {
      for (const deg of horizontalDegs(venue, "baseball", id)) {
        expect(deg, id).toBeGreaterThanOrEqual(90);
        expect(deg, id).toBeLessThanOrEqual(180);
      }
    }
    for (const id of THIRD_BASE.outfield) {
      for (const deg of horizontalDegs(venue, "baseball", id)) {
        expect(deg, id).toBeGreaterThanOrEqual(-180);
        expect(deg, id).toBeLessThanOrEqual(-90);
      }
    }
  });

  it("打者之眼兩側最靠中外野的 137、140：每一席 |角度| ≥ 150°", () => {
    for (const id of ["137", "140"]) for (const deg of horizontalDegs(dome(), "baseball", id)) expect(Math.abs(deg), id).toBeGreaterThanOrEqual(150);
  });
});

describe("taipei-dome：演唱會（暫定假設：外野端台）", () => {
  it.each(CONCERT_CLOSED)("外野 %s 區在舞台正後方，不開放 → SECTION_NOT_IN_LAYOUT", (sectionId) => {
    expectSeatError(() => getSeatView(dome(), "concert", sectionId, 1, 1), "SECTION_NOT_IN_LAYOUT");
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
