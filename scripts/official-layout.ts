/**
 * 依官方票區排臺北大巨蛋的棒球看台（產生器用）。
 * 區號、層別、相鄰關係、排數下限、票面標籤是 B（公開資料）；每區的寬度與每排長度是 C（依規則推算，不是描摹座位圖）。
 *
 * 幾何（座標同 src/core/schema.ts，本壘在場地下方、一壘側是 +x）：
 * - B1 內野：本壘後方是以本壘為圓心的弧（107–119），兩側是平行界外線的直線看台（102–106 一壘側、120–124 三壘側）。
 * - L2 內野：同樣的弧與直線，從 B1 第 (startRow + 1) 排正上方開始，懸挑在 B1 後段上方。213 是本壘正後方的空位。
 * - B1 外野：與外野牆同心的弧；中外野的打者之眼（138、139）不建。
 * 每一排沿自己的線走，被穹頂外框（留 margin）截斷，所以排的長度各不相同（rowSpans）。
 */
import type { Section } from "../src/core/schema.ts";
import type { Field } from "./dome-field.ts";
import { signedDistance, type PlanPoint } from "./outline.ts";

const DEG = Math.PI / 180;
const S45 = Math.SQRT1_2;
/** 截斷時再多留 1 cm：輸出四捨五入到 mm 之後，外框淨空仍不小於 margin。 */
const ROUNDING_ALLOWANCE = 0.01;
const mm = (v: number) => Math.round(v * 1000) / 1000;
/** rowSpans 的比例取到 1e-6：30 m 的區也只差 0.03 mm，不會吃掉截斷時多留的 1 cm。 */
const frac = (v: number) => Math.round(v * 1e6) / 1e6;
const point = (x: number, z: number): PlanPoint => ({ x: mm(x), z: mm(z) });
const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

export interface OfficialParams {
  foulOffset: number;
  rowDepth: number;
  pitch: number;
  outlineMargin: number;
  outfieldClearance: number;
  b1: { rows: number; rowRise: number; baseHeight: number };
  outfield: { rows: number; rowRise: number; baseHeight: number; eyeHalfDeg: number };
  l2: { startRow: number; rows: Record<string, number>; defaultRows: number; rowRise: number; headroom: number };
  /** 靠界外桿那一區最多是鄰區平均寬的幾倍 */
  endCap: number;
  /** 靠界外桿那一區的最後一排至少留多長（m） */
  farBackWidth: number;
  /** 最後一排要剛好幾席的區（票面標籤：201 第 15 排剛好 15 席） */
  exactLastRow: Record<string, number>;
  /** 票面標籤要求的最小寬度（m）：直線區用長度、外野用標籤那一排的弧長 */
  minWidth: Record<string, number>;
  /** 標籤 142 在第 9 排：外野的寬度在這一排的弧長上分配 */
  outfieldWidthRow: number;
  concertClosed: string[];
}

/** 同一個 key 只算一次：同一排的截斷長度每一區都要用，不用每區重算。 */
function memo<K>(compute: (key: K) => number): (key: K) => number {
  const cache = new Map<K, number>();
  return (key) => {
    let value = cache.get(key);
    if (value === undefined) {
      value = compute(key);
      cache.set(key, value);
    }
    return value;
  };
}

/** 依最小寬度切分 [0, total]：最小寬度大於平均分的區用最小寬度，其餘平分剩下的。order[0] 從 0 開始。 */
export function splitByMinWidth(order: string[], total: number, minWidth: Record<string, number>): Record<string, [number, number]> {
  const fixed = new Set<string>();
  let rest = total / order.length;
  for (;;) {
    const before = fixed.size;
    for (const id of order) if ((minWidth[id] ?? 0) > rest) fixed.add(id);
    rest = (total - [...fixed].reduce((t, id) => t + (minWidth[id] ?? 0), 0)) / Math.max(1, order.length - fixed.size);
    if (fixed.size === before) break;
  }
  if (rest <= 0 || fixed.size === order.length) {
    if ([...fixed].reduce((t, id) => t + (minWidth[id] ?? 0), 0) > total) throw new Error(`長度 ${total.toFixed(2)} m 放不下最小寬度`);
  }
  const out: Record<string, [number, number]> = {};
  let at = 0;
  for (const id of order) {
    const width = fixed.has(id) ? (minWidth[id] ?? 0) : rest;
    out[id] = [at, at + width];
    at += width;
  }
  return out;
}

/** 一排可用的長度 [a, b]（m）裡以固定間距放座位：席數 = 可用長度 ÷ 間距取整，座位置中。 */
export function centeredSpan([a, b]: [number, number], pitch: number): { seats: number; span: [number, number] } {
  const seats = Math.max(0, Math.floor((b - a) / pitch + 1e-9));
  const middle = (a + b) / 2;
  return { seats, span: [middle - (seats * pitch) / 2, middle + (seats * pitch) / 2] };
}

/** 從 0 往 limit 走，inside 連續成立的最遠距離（先一步 step，再二分到 1e-6，結果跟步長無關）。 */
function reach(inside: (t: number) => boolean, limit: number, step: number): number {
  if (!inside(0)) return 0;
  let t = 0;
  while (t + step <= limit && inside(t + step)) t += step;
  let [lo, hi] = [t, Math.min(limit, t + step)];
  if (inside(hi)) return hi;
  while (hi - lo > 1e-6) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function officialStands(field: Field, outline: PlanPoint[], params: OfficialParams): Section[] {
  const { foulOffset, rowDepth, pitch } = params;
  const plate = field.plate;
  const poleDistance = Math.hypot(field.rightPole.x - plate.x, field.rightPole.z - plate.z);
  const inside = (p: PlanPoint) => signedDistance(outline, p) >= params.outlineMargin + ROUNDING_ALLOWANCE;

  // side = +1：一壘側（+x）；−1：三壘側
  const linePoint = (side: number, offset: number, s: number) => ({
    x: plate.x + side * S45 * (s + offset),
    z: plate.z + S45 * (offset - s),
  });
  const lineReachOn = (side: 1 | -1) => memo((offset: number) => reach((s) => inside(linePoint(side, offset, s)), poleDistance, 1));
  const lineReaches = { 1: lineReachOn(1), [-1]: lineReachOn(-1) };
  const lineReach = (side: 1 | -1, offset: number) => lineReaches[side](offset);
  const arcPoint = (radius: number, deg: number) => ({ x: plate.x + radius * Math.cos(deg * DEG), z: plate.z + radius * Math.sin(deg * DEG) });
  /** 本壘後方的弧：從 90° 往兩側在外框內的角度範圍（最多到 45°／135°） */
  const arcLow = memo((radius: number) => 90 - reach((d) => inside(arcPoint(radius, 90 - d)), 45, 1));
  const arcHigh = memo((radius: number) => 90 + reach((d) => inside(arcPoint(radius, 90 + d)), 45, 1));
  const arcReach = (radius: number): [number, number] => [arcLow(radius), arcHigh(radius)];
  const rowsOf = (id: string, layer: "b1" | "l2") => (layer === "b1" ? params.b1.rows : (params.l2.rows[id] ?? params.l2.defaultRows));

  const b1Top = params.b1.baseHeight + (params.b1.rows - 1) * params.b1.rowRise;
  const layers = {
    b1: { firstOffset: foulOffset, rowRise: params.b1.rowRise, baseHeight: params.b1.baseHeight, tier: false },
    l2: { firstOffset: foulOffset + params.l2.startRow * rowDepth, rowRise: params.l2.rowRise, baseHeight: mm(b1Top + params.l2.headroom), tier: true },
  } as const;

  const sections: Section[] = [];
  const base = (id: string, layer: "b1" | "l2", rows: number) => ({
    id,
    rows,
    rowDepth,
    rowRise: layers[layer].rowRise,
    baseHeight: layers[layer].baseHeight,
    ...(layers[layer].tier ? { structure: "tier" as const } : {}),
  });
  const finish = (id: string, seats: number[]) => {
    const empty = seats.findIndex((n) => n === 0);
    if (empty >= 0) throw new Error(`${id} 區第 ${empty + 1} 排放不下任何座位`);
  };

  // ── 內野：直線區（每一層、每一側）
  const lineStands = (layer: "b1" | "l2", side: 1 | -1, nearFromHome: string[], farId: string) => {
    const offset = (r: number) => layers[layer].firstOffset + (r - 1) * rowDepth;
    const front = lineReach(side, offset(1));
    const farRows = rowsOf(farId, layer);
    const farBack = params.exactLastRow[farId] !== undefined ? params.exactLastRow[farId]! * pitch + pitch / 2 : params.farBackWidth;
    const farStart = lineReach(side, offset(farRows)) - farBack;
    const near = splitByMinWidth(nearFromHome, farStart, params.minWidth);
    const meanNear = farStart / nearFromHome.length;
    const ranges: Record<string, [number, number]> = { ...near, [farId]: [farStart, Math.min(front, farStart + params.endCap * meanNear)] };
    for (const id of [...nearFromHome, farId]) {
      const [s0, s1] = ranges[id]!;
      const rows = rowsOf(id, layer);
      const seatsPerRow: number[] = [];
      const rowSpans: [number, number][] = [];
      for (let r = 1; r <= rows; r++) {
        const { seats, span } = centeredSpan([s0, Math.min(s1, lineReach(side, offset(r)))], pitch);
        seatsPerRow.push(seats);
        // 座號慣例：面向場地時往左增加 → 一壘側從界外桿那端（s1）編起，三壘側從本壘那端（s0）編起
        rowSpans.push(side === 1 ? [frac((s1 - span[1]) / (s1 - s0)), frac((s1 - span[0]) / (s1 - s0))] : [frac((span[0] - s0) / (s1 - s0)), frac((span[1] - s0) / (s1 - s0))]);
      }
      finish(id, seatsPerRow);
      const [from, to] = side === 1 ? [linePoint(side, offset(1), s1), linePoint(side, offset(1), s0)] : [linePoint(side, offset(1), s0), linePoint(side, offset(1), s1)];
      sections.push({
        ...base(id, layer, rows),
        type: "linear",
        from: point(from.x, from.z),
        to: point(to.x, to.z),
        facing: point(plate.x, plate.z),
        seatsPerRow,
        rowSpans,
      });
    }
  };

  // ── 內野：本壘後方的弧（45° 一壘側 → 135° 三壘側平分；null 是空位）
  const arcStands = (layer: "b1" | "l2", slots: (string | null)[]) => {
    const offset = (r: number) => layers[layer].firstOffset + (r - 1) * rowDepth;
    const step = 90 / slots.length;
    slots.forEach((id, k) => {
      if (id === null) return;
      // 先取到 mm，比例才跟輸出的 fromDeg／toDeg 對得上
      const [from, to] = [mm(45 + k * step), mm(45 + (k + 1) * step)];
      const rows = rowsOf(id, layer);
      const seatsPerRow: number[] = [];
      const rowSpans: [number, number][] = [];
      for (let r = 1; r <= rows; r++) {
        const radius = offset(r);
        const [lo, hi] = arcReach(radius);
        const a = Math.max(from, lo);
        const b = Math.min(to, hi);
        const { seats, span } = centeredSpan([a * DEG * radius, b * DEG * radius], pitch);
        seatsPerRow.push(seats);
        rowSpans.push([frac((span[0] / radius / DEG - from) / (to - from)), frac((span[1] / radius / DEG - from) / (to - from))]);
      }
      finish(id, seatsPerRow);
      sections.push({
        ...base(id, layer, rows),
        type: "arc",
        center: point(plate.x, plate.z),
        innerRadius: mm(layers[layer].firstOffset),
        fromDeg: from,
        toDeg: to,
        seatsPerRow,
        rowSpans,
      });
    });
  };

  lineStands("b1", 1, ids(103, 106).reverse(), "102");
  arcStands("b1", ids(107, 119));
  lineStands("b1", -1, ids(120, 123), "124");
  lineStands("l2", 1, ids(202, 206).reverse(), "201");
  arcStands("l2", [...ids(207, 212), null, ...ids(214, 219)]);
  lineStands("l2", -1, ids(220, 224), "225");

  // ── B1 外野：與外野牆同心；右外野 140–146（146 靠界外桿）、左外野 131–137（131 靠界外桿）
  const center = point(field.wallCenter.x, field.wallCenter.z);
  const shift = Math.hypot(center.x - field.wallCenter.x, center.z - field.wallCenter.z);
  // 第一排半徑無條件進位到 mm，輸出後離外野牆仍 ≥ 淨空
  const innerRadius = Math.ceil((field.wallRadius + params.outfieldClearance + shift + 0.001) * 1000) / 1000;
  const radiusOf = (r: number) => innerRadius + (r - 1) * rowDepth;
  const ofPoint = (radius: number, deg: number) => ({ x: center.x + radius * Math.cos(deg * DEG), z: center.z + radius * Math.sin(deg * DEG) });
  const eye = params.outfield.eyeHalfDeg;
  const outfieldSide = (sign: 1 | -1, nearFromCenter: string[], farId: string) => {
    const eyeEdge = -90 + sign * eye;
    const limit = memo((radius: number) => eyeEdge + sign * reach((d) => inside(ofPoint(radius, eyeEdge + sign * d)), 75, 0.5));
    const rows = params.outfield.rows;
    const front = limit(radiusOf(1));
    // 取到 0.001° 時往中外野那側取整：四捨五入可能讓最後一排少不到 1 mm，剛好放不下最後一席
    const towardCenter = (deg: number) => (sign === 1 ? Math.floor(deg * 1000) : Math.ceil(deg * 1000)) / 1000;
    const farStart = towardCenter(limit(radiusOf(rows)) - (sign * (params.farBackWidth / radiusOf(rows))) / DEG);
    const widthRadius = radiusOf(params.outfieldWidthRow);
    const near = splitByMinWidth(nearFromCenter, (Math.abs(farStart - eyeEdge) * DEG) * widthRadius, params.minWidth);
    const toAngle = (length: number) => eyeEdge + (sign * length) / widthRadius / DEG;
    const meanNear = Math.abs(farStart - eyeEdge) / nearFromCenter.length;
    const farEnd = sign === 1 ? Math.min(front, farStart + params.endCap * meanNear) : Math.max(front, farStart - params.endCap * meanNear);
    const angles: Record<string, [number, number]> = { [farId]: [farStart, farEnd] };
    for (const id of nearFromCenter) angles[id] = [toAngle(near[id]![0]), toAngle(near[id]![1])];
    for (const id of [...nearFromCenter, farId]) {
      const [a0, a1] = angles[id]!;
      const [from, to] = [mm(Math.min(a0, a1)), mm(Math.max(a0, a1))];
      const seatsPerRow: number[] = [];
      const rowSpans: [number, number][] = [];
      for (let r = 1; r <= rows; r++) {
        const radius = radiusOf(r);
        const edge = limit(radius);
        const [a, b] = sign === 1 ? [from, Math.min(to, edge)] : [Math.max(from, edge), to];
        const { seats, span } = centeredSpan([a * DEG * radius, b * DEG * radius], pitch);
        seatsPerRow.push(seats);
        rowSpans.push([frac((span[0] / radius / DEG - from) / (to - from)), frac((span[1] / radius / DEG - from) / (to - from))]);
      }
      finish(id, seatsPerRow);
      sections.push({
        id,
        type: "arc",
        center,
        innerRadius,
        fromDeg: from,
        toDeg: to,
        rows,
        rowDepth,
        rowRise: params.outfield.rowRise,
        baseHeight: params.outfield.baseHeight,
        seatsPerRow,
        rowSpans,
        ...(params.concertClosed.includes(id) ? { layouts: ["baseball"] } : {}),
      });
    }
  };
  outfieldSide(-1, ids(132, 137).reverse(), "131");
  outfieldSide(1, ids(140, 145), "146");

  // 輸出順序：B1 內野（102 → 124）、B1 外野（131 → 146）、L2 內野（201 → 225）
  const order = (id: string) => Number(id);
  return sections.sort((a, b) => order(a.id) - order(b.id));
}
