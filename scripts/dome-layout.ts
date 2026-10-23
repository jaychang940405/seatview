/**
 * 臺北大巨蛋方案 B 的看台幾何與擬合：
 *   本壘後方 = 以本壘為圓心的弧（45°→135°）；一三壘側 = 平行界外線的直線看台；外野 = 與外野牆同心的弧。
 * 二層可以懸挑在一層後段上方（baseHeight = 一層後排高度 + 淨空）。
 * 座標同 src/core/schema.ts。
 */
import { insetConvexPolygon, radialChecker, superellipsePolygon, type PlanPoint, type Superellipse } from "./outline.ts";

export interface Field {
  plate: PlanPoint;
  rightPole: PlanPoint;
  leftPole: PlanPoint;
  centerField: PlanPoint;
  wallCenter: PlanPoint;
  wallRadius: number;
}

const DEG = Math.PI / 180;
const S45 = Math.SQRT1_2;
/** 輸出到 mm：JSON 好讀，誤差遠小於任何容許值。 */
const mm = (v: number) => Math.round(v * 1000) / 1000;
const point = (x: number, z: number): PlanPoint => ({ x: mm(x), z: mm(z) });

export function circleThrough(a: PlanPoint, b: PlanPoint, c: PlanPoint): { center: PlanPoint; radius: number } {
  const d = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
  if (Math.abs(d) < 1e-9) throw new Error("三點共線，畫不出圓弧");
  const a2 = a.x ** 2 + a.z ** 2;
  const b2 = b.x ** 2 + b.z ** 2;
  const c2 = c.x ** 2 + c.z ** 2;
  const center = {
    x: (a2 * (b.z - c.z) + b2 * (c.z - a.z) + c2 * (a.z - b.z)) / d,
    z: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
  return { center, radius: Math.hypot(a.x - center.x, a.z - center.z) };
}

/** 本壘在 (0, plateZ)，往 −z 是場內；界外桿在本壘到中外野軸線兩側 ±45°。 */
export function fieldGeometry(plateZ: number, foulPole: number, centerField: number): Field {
  const plate = { x: 0, z: plateZ };
  const rightPole = { x: foulPole * S45, z: plateZ - foulPole * S45 };
  const leftPole = { x: -rightPole.x, z: rightPole.z };
  const center = { x: 0, z: plateZ - centerField };
  const wall = circleThrough(leftPole, center, rightPole);
  return { plate, rightPole, leftPole, centerField: center, wallCenter: wall.center, wallRadius: wall.radius };
}

/**
 * 外野牆圓弧兩端的角度（以外野牆圓心量）：右外野桿約 −21°，往中外野（−90°）遞減到左外野桿 = −180° − 右桿。
 * 之前的分析曾寫成 180° − 右桿，弧會繞到本壘那一側。
 */
export function outfieldArcAngles(field: Field): { right: number; left: number } {
  const right = Math.atan2(field.rightPole.z - field.wallCenter.z, field.rightPole.x - field.wallCenter.x) / DEG;
  return { right, left: -180 - right };
}

export interface LayoutParams {
  /** 一層前緣離界外線（與本壘）的距離 */
  foulOffset: number;
  rowDepth: number;
  /** 座位寬（每排席數 = 長度 ÷ pitch 取整） */
  pitch: number;
  lower: { rows: number; lineLength: number; rowRise: number; baseHeight: number };
  /** startRow：二層前緣懸在一層第 startRow + 1 排的正上方 */
  upper: { startRow: number; rows: number; lineLength: number; rowRise: number; headroom: number };
  /** insetDeg：外野左右兩區從界外桿往中外野內縮的角度 */
  outfield: { clearance: number; insetDeg: number; sideRows: number; centerRows: number; rowRise: number; baseHeight: number };
}

type StandBase = { id: string; name: string; rows: number; rowDepth: number; rowRise: number; baseHeight: number; layouts?: string[] };
export type ArcStand = StandBase & { type: "arc"; center: PlanPoint; innerRadius: number; fromDeg: number; toDeg: number; seatsPerRow: number[] };
export type LinearStand = StandBase & { type: "linear"; from: PlanPoint; to: PlanPoint; facing: PlanPoint; seatsPerRow: number };
export type StandSection = ArcStand | LinearStand;

/** 一層最後一排的高度。 */
export function lowerBackHeight(params: LayoutParams): number {
  return mm(params.lower.baseHeight + params.lower.rowRise * (params.lower.rows - 1));
}

/** 二層 baseHeight = 一層最後一排高度 + 淨空。 */
export function upperBaseHeight(params: LayoutParams): number {
  return mm(lowerBackHeight(params) + params.upper.headroom);
}

const arcRows = (innerRadius: number, rows: number, spanDeg: number, rowDepth: number, pitch: number) =>
  Array.from({ length: rows }, (_, k) => Math.floor(((innerRadius + rowDepth * k) * Math.abs(spanDeg) * DEG) / pitch));

/**
 * 外野看台的第一排半徑：外野牆半徑 + 淨空，再補上圓心四捨五入到 mm 的位移、多留 1 mm（牆的頂點也四捨五入過），
 * 最後無條件進位到 mm。這樣輸出後的淨空一定不小於 clearance。
 */
function outfieldInnerRadius(field: Field, clearance: number): number {
  const rounded = point(field.wallCenter.x, field.wallCenter.z);
  const shift = Math.hypot(rounded.x - field.wallCenter.x, rounded.z - field.wallCenter.z);
  return Math.ceil((field.wallRadius + clearance + shift + 0.001) * 1000) / 1000;
}

/** 外野三區的角度範圍：右外野、中外野、左外野。 */
function outfieldRanges(field: Field, insetDeg: number): [number, number][] {
  const { right, left } = outfieldArcAngles(field);
  const start = right - insetDeg;
  const span = (start - (left + insetDeg)) / 3;
  return [
    [start, start - span],
    [start - span, start - 2 * span],
    [start - 2 * span, start - 3 * span],
  ];
}

/** 九個看台區（I1-*, I2-*, O1-*），id 與名稱固定。 */
export function buildStands(field: Field, params: LayoutParams): StandSection[] {
  const { rowDepth, pitch, lower, upper, outfield } = params;
  const plate = field.plate;
  const lowerOffset = mm(params.foulOffset);
  const upperOffset = mm(params.foulOffset + rowDepth * upper.startRow);
  const upperBase = upperBaseHeight(params);

  const homeArc = (id: string, name: string, radius: number, rows: number, rowRise: number, baseHeight: number): ArcStand => ({
    id,
    name,
    type: "arc",
    center: point(plate.x, plate.z),
    innerRadius: radius,
    fromDeg: 45,
    toDeg: 135,
    rows,
    rowDepth,
    rowRise,
    baseHeight,
    seatsPerRow: arcRows(radius, rows, 90, rowDepth, pitch),
  });
  // side = 1：一壘側（+x），−1：三壘側；前緣從本壘後方弧的端點沿界外線往外野走 length 公尺
  const line = (id: string, name: string, offset: number, length: number, rows: number, rowRise: number, baseHeight: number, side: 1 | -1): LinearStand => {
    const from = point(plate.x + side * offset * S45, plate.z + offset * S45);
    return {
      id,
      name,
      type: "linear",
      from,
      to: point(from.x + side * length * S45, from.z - length * S45),
      facing: point(plate.x, plate.z),
      rows,
      rowDepth,
      rowRise,
      baseHeight,
      seatsPerRow: Math.floor(length / pitch),
    };
  };
  const outfieldCenter = point(field.wallCenter.x, field.wallCenter.z);
  const outfieldInner = outfieldInnerRadius(field, outfield.clearance);
  const [rf, cf, lf] = outfieldRanges(field, outfield.insetDeg) as [[number, number], [number, number], [number, number]];
  const outfieldArc = (id: string, name: string, [fromDeg, toDeg]: [number, number], rows: number, layouts?: string[]): ArcStand => ({
    id,
    name,
    type: "arc",
    center: outfieldCenter,
    innerRadius: outfieldInner,
    fromDeg: mm(fromDeg),
    toDeg: mm(toDeg),
    rows,
    rowDepth,
    rowRise: outfield.rowRise,
    baseHeight: outfield.baseHeight,
    seatsPerRow: arcRows(outfieldInner, rows, mm(toDeg) - mm(fromDeg), rowDepth, pitch),
    ...(layouts && { layouts }),
  });

  return [
    line("I1-1B", "內野一層・一壘側（模型分區）", lowerOffset, lower.lineLength, lower.rows, lower.rowRise, lower.baseHeight, 1),
    homeArc("I1-HP", "內野一層・本壘後方", lowerOffset, lower.rows, lower.rowRise, lower.baseHeight),
    line("I1-3B", "內野一層・三壘側", lowerOffset, lower.lineLength, lower.rows, lower.rowRise, lower.baseHeight, -1),
    line("I2-1B", "內野二層・一壘側", upperOffset, upper.lineLength, upper.rows, upper.rowRise, upperBase, 1),
    homeArc("I2-HP", "內野二層・本壘後方", upperOffset, upper.rows, upper.rowRise, upperBase),
    line("I2-3B", "內野二層・三壘側", upperOffset, upper.lineLength, upper.rows, upper.rowRise, upperBase, -1),
    outfieldArc("O1-RF", "外野一層・右外野", rf, outfield.sideRows),
    outfieldArc("O1-CF", "外野一層・中外野", cf, outfield.centerRows, ["baseball"]),
    outfieldArc("O1-LF", "外野一層・左外野", lf, outfield.sideRows),
  ];
}

/** 座位數算法一：每排取整後加總（跟產生的 JSON 一致）。 */
export function sectionSeatCount(section: StandSection): number {
  return section.type === "arc" ? section.seatsPerRow.reduce((a, b) => a + b, 0) : section.seatsPerRow * section.rows;
}

/**
 * 座位數算法二：看台平面面積 ÷（座位寬 × 排距），不取整。
 * 弧形看台的平面是扇環（內緣往內、外緣往外各多半排），直線看台是矩形。
 */
export function areaSeatEstimate(section: StandSection, pitch: number): number {
  const d = section.rowDepth;
  if (section.type === "linear") {
    const length = Math.hypot(section.to.x - section.from.x, section.to.z - section.from.z);
    return (length * section.rows * d) / (pitch * d);
  }
  const span = Math.abs(section.toDeg - section.fromDeg) * DEG;
  const inner = section.innerRadius - d / 2;
  const outer = section.innerRadius + d * (section.rows - 1) + d / 2;
  return ((span / 2) * (outer ** 2 - inner ** 2)) / (pitch * d);
}

export type InsideCheck = (p: PlanPoint) => boolean;

/** 一壘側（side = 1）或三壘側（−1）直線看台，最外排離界外線 back 公尺時，最長可以多長（0.5 m 為單位）。 */
export function maxLineLength(field: Field, inside: InsideCheck, back: number, side: 1 | -1, cap: number): number {
  const corner = (length: number) =>
    inside({ x: field.plate.x + side * (back * S45 + length * S45), z: field.plate.z + back * S45 - length * S45 });
  if (!corner(0)) return 0;
  if (corner(cap)) return cap;
  let lo = 0;
  let hi = cap;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (corner(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 2) / 2;
}

/** 本壘後方弧最外排半徑為 back 時，整段弧（每 1° 檢查一次）是否放得下。 */
export function homeArcFits(field: Field, inside: InsideCheck, back: number): boolean {
  for (let deg = 45; deg <= 135; deg += 1) {
    if (!inside({ x: field.plate.x + back * Math.cos(deg * DEG), z: field.plate.z + back * Math.sin(deg * DEG) })) return false;
  }
  return true;
}

/** 外野三區各自最多放得下幾排（左右分開算，方便檢查對稱）。 */
export function outfieldRowsFit(
  field: Field,
  inside: InsideCheck,
  clearance: number,
  rowDepth: number,
  insetDeg: number,
  maxRows: number,
): { right: number; center: number; left: number } {
  const fits = ([from, to]: [number, number]) => {
    let rows = 0;
    for (let k = 1; k <= maxRows; k++) {
      const r = field.wallRadius + clearance + rowDepth * (k - 1);
      const steps = Math.ceil(Math.abs(to - from));
      let ok = true;
      for (let i = 0; i <= steps; i++) {
        const deg = from + ((to - from) * i) / steps;
        if (!inside({ x: field.wallCenter.x + r * Math.cos(deg * DEG), z: field.wallCenter.z + r * Math.sin(deg * DEG) })) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      rows = k;
    }
    return rows;
  };
  const [rf, cf, lf] = outfieldRanges(field, insetDeg) as [[number, number], [number, number], [number, number]];
  return { right: fits(rf), center: fits(cf), left: fits(lf) };
}

export interface FitOptions {
  margin: number;
  anchors: { lower: number; upper: number };
  tolerance: number;
  maxLowerRows: number;
  minOutfieldRows: number;
  /** 本壘相對外框中心的 z 距離範圍 */
  plateRange: [number, number];
  /** 外框中心的 x 範圍 */
  lateralRange: [number, number];
  insetOptions: number[];
  lineCap: number;
}

export interface FitResult {
  params: LayoutParams;
  outlineCenter: PlanPoint;
  lower: number;
  upper: number;
  meetsAnchors: boolean;
}

const LOWER_IDS = ["I1-1B", "I1-HP", "I1-3B", "O1-RF", "O1-CF", "O1-LF"];

/**
 * 在外框（超橢圓，擺放位置也是搜尋變數）裡找方案 B 的參數。
 * 必要條件：所有看台離外框 ≥ margin、一層 ≤ maxLowerRows 排、席數不超過錨點 +tolerance。
 * 偏好：席數落在錨點 ±tolerance → 席數最接近錨點 → 一層排數少 → 外框中心偏離中線少。
 */
export function fitLayout(
  field: Field,
  shape: Omit<Superellipse, "center">,
  template: LayoutParams,
  options: FitOptions,
): FitResult | null {
  const { rowDepth, pitch, foulOffset } = template;
  // 外框只平移，所以內縮多邊形與查表在原點算一次就好
  const origin = { x: 0, z: 0 };
  const insideAtOrigin = radialChecker(insetConvexPolygon(superellipsePolygon({ ...shape, center: origin }, 1), options.margin), origin);
  const homeSeats = (offset: number, rows: number) => arcRows(mm(offset), rows, 90, rowDepth, pitch).reduce((a, b) => a + b, 0);
  const outfieldInner = outfieldInnerRadius(field, template.outfield.clearance);
  const maxBackRows = options.maxLowerRows + 25;

  let best: (Omit<FitResult, "lower" | "upper" | "meetsAnchors"> & { key: number }) | null = null;
  for (let dx = options.lateralRange[0]; dx <= options.lateralRange[1]; dx++) {
    for (let p = options.plateRange[0]; p <= options.plateRange[1]; p++) {
      const center = { x: dx, z: field.plate.z - p };
      const inside: InsideCheck = (q) => insideAtOrigin({ x: q.x - center.x, z: q.z - center.z });
      if (![field.plate, field.rightPole, field.leftPole, field.centerField].every(inside)) continue;

      // 最外排離界外線 foulOffset + rowDepth * j 時：本壘後方弧放不放得下、兩側直線看台最長多長
      const table = Array.from({ length: maxBackRows + 1 }, (_, j) => {
        const back = foulOffset + rowDepth * j;
        return {
          home: homeArcFits(field, inside, back),
          line: Math.min(maxLineLength(field, inside, back, 1, options.lineCap), maxLineLength(field, inside, back, -1, options.lineCap)),
        };
      });
      const outfieldOptions = options.insetOptions.flatMap((insetDeg) => {
        const rows = outfieldRowsFit(field, inside, template.outfield.clearance, rowDepth, insetDeg, options.maxLowerRows);
        const side = Math.min(rows.right, rows.left);
        if (side < options.minOutfieldRows || rows.center < options.minOutfieldRows) return [];
        const [rf, cf] = outfieldRanges(field, insetDeg) as [[number, number], [number, number]];
        const seats = (range: [number, number], n: number) =>
          arcRows(outfieldInner, n, mm(range[1]) - mm(range[0]), rowDepth, pitch).reduce((a, b) => a + b, 0);
        return [{ insetDeg, side, center: rows.center, seats: 2 * seats(rf, side) + seats(cf, rows.center) }];
      });
      if (outfieldOptions.length === 0) continue;

      for (let lowerRows = 1; lowerRows <= options.maxLowerRows; lowerRows++) {
        const t1 = table[lowerRows - 1];
        if (!t1 || !t1.home || t1.line < 10) continue;
        const lowerInfield = homeSeats(foulOffset, lowerRows) + 2 * lowerRows * Math.floor(t1.line / pitch);
        for (let startRow = Math.ceil(lowerRows / 2); startRow <= lowerRows + 3; startRow++) {
          for (let upperRows = 4; upperRows <= 20; upperRows++) {
            const t2 = table[startRow + upperRows - 1];
            if (!t2 || !t2.home || t2.line < 10) continue;
            // 二層懸挑在一層上方，不比一層長
            const upperLine = Math.min(t2.line, t1.line);
            const upper = homeSeats(foulOffset + rowDepth * startRow, upperRows) + 2 * upperRows * Math.floor(upperLine / pitch);
            if (upper > options.anchors.upper * (1 + options.tolerance)) continue;
            for (const o of outfieldOptions) {
              const lower = lowerInfield + o.seats;
              if (lower > options.anchors.lower * (1 + options.tolerance)) continue;
              const lowerMiss = Math.abs(lower - options.anchors.lower) / options.anchors.lower;
              const upperMiss = Math.abs(upper - options.anchors.upper) / options.anchors.upper;
              const meets = lowerMiss <= options.tolerance && upperMiss <= options.tolerance;
              const key = (meets ? 0 : 1e6) + (lowerMiss + upperMiss) * 1e3 + lowerRows * 0.01 + Math.abs(dx) * 1e-4;
              if (best && key >= best.key) continue;
              best = {
                key,
                outlineCenter: center,
                params: {
                  ...template,
                  lower: { ...template.lower, rows: lowerRows, lineLength: t1.line },
                  upper: { ...template.upper, startRow, rows: upperRows, lineLength: upperLine },
                  outfield: { ...template.outfield, insetDeg: o.insetDeg, sideRows: o.side, centerRows: o.center },
                },
              };
            }
          }
        }
      }
    }
  }
  if (!best) return null;

  // 用實際建出來的看台重算席數，跟產生的 JSON 一致
  const stands = buildStands(field, best.params);
  const count = (ids: string[]) => stands.filter((s) => ids.includes(s.id)).reduce((sum, s) => sum + sectionSeatCount(s), 0);
  const lower = count(LOWER_IDS);
  const upper = count(["I2-1B", "I2-HP", "I2-3B"]);
  const meetsAnchors =
    Math.abs(lower - options.anchors.lower) / options.anchors.lower <= options.tolerance &&
    Math.abs(upper - options.anchors.upper) / options.anchors.upper <= options.tolerance;
  return { params: best.params, outlineCenter: best.outlineCenter, lower, upper, meetsAnchors };
}
