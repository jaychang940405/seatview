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
  /**
   * 一三壘側第 1 排的弧半徑（m）：兩側不是直線，而是跟本壘後方的弧相切的大弧，
   * 弧心在場內；越往界外桿，看台越靠近界外線，座位也越往本壘轉
   */
  sideRadius: number;
  /** 靠界外桿那一區的最後一排至少留多長（m） */
  farBackWidth: number;
  /** 最後一排要剛好幾席的區（票面標籤：201 第 15 排剛好 15 席） */
  exactLastRow: Record<string, number>;
  /** 票面標籤要求的最小寬度（m）：直線區用長度、外野用標籤那一排的弧長 */
  minWidth: Record<string, number>;
  /** 標籤 142 在第 9 排：外野的寬度在這一排的弧長上分配 */
  outfieldWidthRow: number;
  concertClosed: string[];
  /** 打者之眼的座椅顏色（只畫外觀的示意量體） */
  eyeSeatColor: string;
  /**
   * 上層看台的示意量體（只畫外觀、不能查詢）：
   * L3–L5 疊在 L2 第 overL2Row 排以後的正上方，每層 rows 排、往上 floorGap；noHomeArc 的層本壘後方不畫（包廂）。
   * L2 外野疊在 B1 外野第 outfieldOverRow 排以後的正上方。
   */
  upper: {
    levels: string[];
    noHomeArc: string[];
    overL2Row: number;
    rows: number;
    rowRise: number;
    floorGap: number;
    outfieldOverRow: number;
    outfieldRows: number;
  };
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

  // ── 一三壘側的大弧（side = +1：一壘側（+x）；−1：三壘側）
  // 弧心在本壘往 45°（135°）交接點那條線上、界外線的另一邊（場內），所以跟本壘後方的弧在交接處相切。
  // 離界外線 offset 的那一排半徑 = sideRadius + (offset − foulOffset)：各排、各層同心，排與排保持平行。
  // s 是那一排從交接處往界外桿走的弧長。
  const sideCenter = (side: 1 | -1): PlanPoint => {
    const k = foulOffset - params.sideRadius;
    return { x: plate.x + k * side * S45, z: plate.z + k * S45 };
  };
  const sideRadiusAt = (offset: number) => params.sideRadius + (offset - foulOffset);
  /** 弧上的角度（度）：一壘側從 45° 往界外桿遞減，三壘側從 135° 遞增 */
  const sideDeg = (side: 1 | -1, phi: number) => (side === 1 ? 45 : 135) - (side * phi) / DEG;
  const sidePoint = (side: 1 | -1, offset: number, s: number) => {
    const c = sideCenter(side);
    const rho = sideRadiusAt(offset);
    const theta = sideDeg(side, s / rho) * DEG;
    return { x: c.x + rho * Math.cos(theta), z: c.z + rho * Math.sin(theta) };
  };
  const sideReachOn = (side: 1 | -1) => memo((offset: number) => reach((s) => inside(sidePoint(side, offset, s)), poleDistance, 1));
  const sideReaches = { 1: sideReachOn(1), [-1]: sideReachOn(-1) };
  /** 這一排在外框內能走到的角度（弧度，從交接處算） */
  const sidePhiReach = (side: 1 | -1, offset: number) => sideReaches[side](offset) / sideRadiusAt(offset);
  /** 角度取到 1e-6°：弧半徑兩百多公尺，取到 0.001° 會差到 2 mm，可能讓剛好的最後一排少一席 */
  const deg6 = (v: number) => Math.round(v * 1e6) / 1e6;
  /** 一個側邊弧形區：[p0, p1] 是從交接處算的角度範圍（弧度），rows 排，第 r 排離界外線 offset(r) */
  const sideSection = (side: 1 | -1, offset: (r: number) => number, rows: number, [p0, p1]: [number, number], id: string) => {
    const seatsPerRow: number[] = [];
    const rowSpans: [number, number][] = [];
    for (let r = 1; r <= rows; r++) {
      const rho = sideRadiusAt(offset(r));
      const { seats, span } = centeredSpan([p0 * rho, Math.min(p1, sidePhiReach(side, offset(r))) * rho], pitch);
      seatsPerRow.push(seats);
      const [f0, f1] = [span[0] / rho, span[1] / rho];
      // 座號慣例：面向場地時往左增加 → 一壘側從界外桿那端編起，三壘側從本壘那端編起
      rowSpans.push(side === 1 ? [frac((p1 - f1) / (p1 - p0)), frac((p1 - f0) / (p1 - p0))] : [frac((f0 - p0) / (p1 - p0)), frac((f1 - p0) / (p1 - p0))]);
    }
    finish(id, seatsPerRow);
    const c = sideCenter(side);
    const [fromDeg, toDeg] = side === 1 ? [sideDeg(1, p1), sideDeg(1, p0)] : [sideDeg(-1, p0), sideDeg(-1, p1)];
    return {
      type: "arc" as const,
      center: point(c.x, c.z),
      innerRadius: mm(sideRadiusAt(offset(1))),
      fromDeg: deg6(fromDeg),
      toDeg: deg6(toDeg),
      seatsPerRow,
      rowSpans,
    };
  };
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
    level: layer === "b1" ? "B1" : "L2",
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

  // ── 內野：一三壘側（每一層、每一側），區界是從弧心出發的放射線
  const lineStands = (layer: "b1" | "l2", side: 1 | -1, nearFromHome: string[], farId: string) => {
    const offset = (r: number) => layers[layer].firstOffset + (r - 1) * rowDepth;
    const farRows = rowsOf(farId, layer);
    const farBack = params.exactLastRow[farId] !== undefined ? params.exactLastRow[farId]! * pitch + pitch / 2 : params.farBackWidth;
    // 端區從「最後一排還留 farBack」的角度開始
    const farStart = sidePhiReach(side, offset(farRows)) - farBack / sideRadiusAt(offset(farRows));
    // 寬度在第 1 排的弧長上切分（後排半徑較大、比較長，所以票面標籤需要的寬度在後排一定夠）
    const ref = sideRadiusAt(offset(1));
    const near = splitByMinWidth(nearFromHome, farStart * ref, params.minWidth);
    const meanNear = farStart / nearFromHome.length;
    const ranges: Record<string, [number, number]> = {
      ...Object.fromEntries(nearFromHome.map((id) => [id, [near[id]![0] / ref, near[id]![1] / ref]])),
      [farId]: [farStart, Math.min(sidePhiReach(side, offset(1)), farStart + params.endCap * meanNear)],
    };
    for (const id of [...nearFromHome, farId]) {
      const rows = rowsOf(id, layer);
      sections.push({ ...base(id, layer, rows), ...sideSection(side, offset, rows, ranges[id]!, id) });
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
  /** 外野某個半徑的一排，從打者之眼邊緣往界外桿方向，在外框內能走到的角度 */
  const outfieldLimitOn = (sign: 1 | -1) =>
    memo((radius: number) => -90 + sign * eye + sign * reach((d) => inside(ofPoint(radius, -90 + sign * eye + sign * d)), 75, 0.5));
  const outfieldLimits = { 1: outfieldLimitOn(1), [-1]: outfieldLimitOn(-1) };
  const outfieldSide = (sign: 1 | -1, nearFromCenter: string[], farId: string) => {
    const eyeEdge = -90 + sign * eye;
    const limit = outfieldLimits[sign];
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
        level: "B1",
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

  // 打者之眼（138、139 的位置）：中外野 ±eye 的深色座位，只畫外觀、不能查詢，id 不用官方票區號
  const eyeSeats: number[] = [];
  const eyeSpans: [number, number][] = [];
  for (let r = 1; r <= params.outfield.rows; r++) {
    const radius = radiusOf(r);
    const { seats, span } = centeredSpan([(-90 - eye) * DEG * radius, (-90 + eye) * DEG * radius], pitch);
    eyeSeats.push(seats);
    eyeSpans.push([frac((span[0] / radius / DEG + 90 + eye) / (2 * eye)), frac((span[1] / radius / DEG + 90 + eye) / (2 * eye))]);
  }
  finish("batters-eye", eyeSeats);
  const battersEye: Section = {
    id: "batters-eye",
    level: "B1",
    massing: true,
    seatColor: params.eyeSeatColor,
    type: "arc",
    center,
    innerRadius,
    fromDeg: -90 - eye,
    toDeg: -90 + eye,
    rows: params.outfield.rows,
    rowDepth,
    rowRise: params.outfield.rowRise,
    baseHeight: params.outfield.baseHeight,
    seatsPerRow: eyeSeats,
    rowSpans: eyeSpans,
  };

  // ── 上層看台的示意量體（只畫外觀、不能查詢；id 不用官方票區號）
  const massing: Section[] = [battersEye];
  const up = params.upper;
  const tierBase = (id: string, level: string, rows: number, baseHeight: number) => ({
    id,
    level,
    massing: true as const,
    structure: "tier" as const,
    rows,
    rowDepth,
    rowRise: up.rowRise,
    baseHeight: mm(baseHeight),
  });

  // L3–L5：沿 L2 的線與弧，從 L2 第 overL2Row 排正上方開始，一層比一層高 floorGap
  const upperOffset = (r: number) => layers.l2.firstOffset + (up.overL2Row - 1 + r - 1) * rowDepth;
  const overL2Height = layers.l2.baseHeight + (up.overL2Row - 1) * layers.l2.rowRise;
  const upperLine = (id: string, level: string, side: 1 | -1, baseHeight: number) => {
    const reach = Math.max(...Array.from({ length: up.rows }, (_, i) => sidePhiReach(side, upperOffset(i + 1))));
    massing.push({ ...tierBase(id, level, up.rows, baseHeight), ...sideSection(side, upperOffset, up.rows, [0, reach], id) });
  };
  const upperArc = (id: string, level: string, baseHeight: number) => {
    const seatsPerRow: number[] = [];
    const rowSpans: [number, number][] = [];
    for (let r = 1; r <= up.rows; r++) {
      const radius = upperOffset(r);
      const [lo, hi] = arcReach(radius);
      const { seats, span } = centeredSpan([Math.max(45, lo) * DEG * radius, Math.min(135, hi) * DEG * radius], pitch);
      seatsPerRow.push(seats);
      rowSpans.push([frac((span[0] / radius / DEG - 45) / 90), frac((span[1] / radius / DEG - 45) / 90)]);
    }
    finish(id, seatsPerRow);
    massing.push({ ...tierBase(id, level, up.rows, baseHeight), type: "arc", center: point(plate.x, plate.z), innerRadius: mm(upperOffset(1)), fromDeg: 45, toDeg: 135, seatsPerRow, rowSpans });
  };
  up.levels.forEach((level, k) => {
    const baseHeight = overL2Height + (k + 1) * up.floorGap;
    upperLine(`upper-${level}-1b`, level, 1, baseHeight);
    if (!up.noHomeArc.includes(level)) upperArc(`upper-${level}-home`, level, baseHeight);
    upperLine(`upper-${level}-3b`, level, -1, baseHeight);
  });

  // L2 外野：從 B1 外野第 outfieldOverRow 排正上方開始；左右兩段到外框，中間 ±eye 是深色的打者之眼
  const outfieldRadius = (r: number) => radiusOf(up.outfieldOverRow + r - 1);
  const outfieldBase = params.outfield.baseHeight + (up.outfieldOverRow - 1) * params.outfield.rowRise + up.floorGap;
  const upperOutfield = (id: string, range: (radius: number) => [number, number], seatColor?: string) => {
    const radii = Array.from({ length: up.outfieldRows }, (_, i) => outfieldRadius(i + 1));
    const ranges = radii.map(range);
    const from = mm(Math.min(...ranges.map(([a]) => a)));
    const to = mm(Math.max(...ranges.map(([, b]) => b)));
    const seatsPerRow: number[] = [];
    const rowSpans: [number, number][] = [];
    radii.forEach((radius, i) => {
      const [a, b] = ranges[i] ?? [0, 0];
      const { seats, span } = centeredSpan([Math.max(from, a) * DEG * radius, Math.min(to, b) * DEG * radius], pitch);
      seatsPerRow.push(seats);
      rowSpans.push([frac((span[0] / radius / DEG - from) / (to - from)), frac((span[1] / radius / DEG - from) / (to - from))]);
    });
    finish(id, seatsPerRow);
    massing.push({
      ...tierBase(id, "L2", up.outfieldRows, outfieldBase),
      ...(seatColor !== undefined && { seatColor }),
      type: "arc",
      center,
      innerRadius: mm(outfieldRadius(1)),
      fromDeg: from,
      toDeg: to,
      seatsPerRow,
      rowSpans,
    });
  };
  upperOutfield("upper-L2-outfield-left", (radius) => [outfieldLimits[-1](radius), -90 - eye]);
  upperOutfield("upper-L2-outfield-eye", () => [-90 - eye, -90 + eye], params.eyeSeatColor);
  upperOutfield("upper-L2-outfield-right", (radius) => [-90 + eye, outfieldLimits[1](radius)]);

  // 輸出順序：B1 內野（102 → 124）、B1 外野（131 → 146）、L2 內野（201 → 225），示意量體放最後
  const order = (id: string) => Number(id);
  return [...sections.sort((a, b) => order(a.id) - order(b.id)), ...massing];
}
