/**
 * 外框幾何：用來檢查看台有沒有放進場館外框。
 * 座標同 src/core/schema.ts：平面 (x, z)，x 向右、z 向下；角度從 +x 轉向 +z。
 */

export type PlanPoint = { x: number; z: number };

/** |x'/a|^n + |z'/b|^n = 1，x'、z' 是相對中心、反向旋轉 rotationDeg 後的座標。 */
export interface Superellipse {
  center: PlanPoint;
  semiAxisX: number;
  semiAxisZ: number;
  exponent: number;
  rotationDeg: number;
}

const DEG = Math.PI / 180;

/** 從中心沿 deg 方向到超橢圓邊界的距離。 */
export function superellipseRadius(shape: Superellipse, deg: number): number {
  const a = (deg - shape.rotationDeg) * DEG;
  const n = shape.exponent;
  return Math.pow(Math.abs(Math.cos(a) / shape.semiAxisX) ** n + Math.abs(Math.sin(a) / shape.semiAxisZ) ** n, -1 / n);
}

/** 每 stepDeg 取一點連成的多邊形；超橢圓是凸的，所以多邊形內接於曲線（偏保守）。 */
export function superellipsePolygon(shape: Superellipse, stepDeg = 1): PlanPoint[] {
  const count = Math.round(360 / stepDeg);
  return Array.from({ length: count }, (_, i) => {
    const deg = i * stepDeg;
    const r = superellipseRadius(shape, deg);
    return { x: shape.center.x + r * Math.cos(deg * DEG), z: shape.center.z + r * Math.sin(deg * DEG) };
  });
}

export function pointInPolygon(polygon: PlanPoint[], p: PlanPoint): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as PlanPoint;
    const b = polygon[j] as PlanPoint;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function segmentDistance(p: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}

/** 正值 = 在多邊形內、離邊界多遠；負值 = 超出多遠。 */
export function signedDistance(polygon: PlanPoint[], p: PlanPoint): number {
  let nearest = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    nearest = Math.min(nearest, segmentDistance(p, polygon[i] as PlanPoint, polygon[(i + 1) % polygon.length] as PlanPoint));
  }
  return pointInPolygon(polygon, p) ? nearest : -nearest;
}

/** 凸多邊形往內縮 margin（每條邊往內平移後，相鄰兩邊求交點）。 */
export function insetConvexPolygon(polygon: PlanPoint[], margin: number): PlanPoint[] {
  const centroid = areaCentroid(polygon);
  const n = polygon.length;
  const lines = polygon.map((p, i) => {
    const q = polygon[(i + 1) % n] as PlanPoint;
    const d = { x: q.x - p.x, z: q.z - p.z };
    const len = Math.hypot(d.x, d.z);
    let normal = { x: -d.z / len, z: d.x / len };
    // 法線要指向多邊形內側（形心那一邊）
    if (normal.x * (centroid.x - p.x) + normal.z * (centroid.z - p.z) < 0) normal = { x: -normal.x, z: -normal.z };
    return { p: { x: p.x + normal.x * margin, z: p.z + normal.z * margin }, d };
  });
  return lines.map((line, i) => {
    const prev = lines[(i + n - 1) % n] as (typeof lines)[number];
    const denom = prev.d.x * line.d.z - prev.d.z * line.d.x;
    const t = ((line.p.x - prev.p.x) * line.d.z - (line.p.z - prev.p.z) * line.d.x) / denom;
    return { x: prev.p.x + prev.d.x * t, z: prev.p.z + prev.d.z * t };
  });
}

/** 從 center 沿 deg 方向到多邊形邊界的距離（多邊形要包含 center）。 */
function rayToPolygon(polygon: PlanPoint[], center: PlanPoint, deg: number): number {
  const ux = Math.cos(deg * DEG);
  const uz = Math.sin(deg * DEG);
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as PlanPoint;
    const b = polygon[(i + 1) % polygon.length] as PlanPoint;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const denom = ux * ez - uz * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((a.x - center.x) * ez - (a.z - center.z) * ex) / denom; // 沿射線
    const s = ((a.x - center.x) * uz - (a.z - center.z) * ux) / denom; // 沿邊
    // 射線剛好穿過頂點時，浮點誤差會讓相鄰兩條邊都判定「沒交到」，所以 s 留一點容差
    if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, t);
  }
  if (!Number.isFinite(best)) throw new Error(`射線 ${deg}° 沒有交到多邊形，center 可能不在多邊形內`);
  return best;
}

/**
 * 對「相對 center 是星形」的多邊形做快速內外判斷：預先算好每 stepDeg 的邊界距離，判斷時查表。
 * 擬合搜尋要判斷上千萬次，逐邊計算太慢。
 */
export function radialChecker(polygon: PlanPoint[], center: PlanPoint, stepDeg = 0.25): (p: PlanPoint) => boolean {
  const count = Math.round(360 / stepDeg);
  const table = Array.from({ length: count + 1 }, (_, i) => rayToPolygon(polygon, center, i * stepDeg));
  return (p) => {
    const dx = p.x - center.x;
    const dz = p.z - center.z;
    let deg = Math.atan2(dz, dx) / DEG;
    if (deg < 0) deg += 360;
    const i = Math.floor(deg / stepDeg);
    const f = deg / stepDeg - i;
    const limit = (table[i] as number) * (1 - f) + (table[i + 1] as number) * f;
    return Math.hypot(dx, dz) <= limit;
  };
}

/** 多邊形的面積形心（不是頂點平均：頂點分布不均時兩者會差好幾公尺）。 */
export function areaCentroid(polygon: PlanPoint[]): PlanPoint {
  let area = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i] as PlanPoint;
    const q = polygon[(i + 1) % polygon.length] as PlanPoint;
    const cross = p.x * q.z - q.x * p.z;
    area += cross;
    cx += (p.x + q.x) * cross;
    cz += (p.z + q.z) * cross;
  }
  return { x: cx / (3 * area), z: cz / (3 * area) };
}

/**
 * 給定中心到真實邊界的距離（每個方向一筆），找出內接（不超出）且最貼近的超橢圓。
 * 回傳參數與最大內縮差距（真實邊界比超橢圓多出來的最大距離）。
 * 做法：網格搜尋半軸比例、指數、旋轉，每組都縮放到剛好內接，取最大差距最小的一組，再細調一次。
 */
export function fitInscribedSuperellipse(
  radii: { deg: number; r: number }[],
  center: PlanPoint,
): { shape: Superellipse; maxGap: number } {
  const evaluate = (semiAxisX: number, semiAxisZ: number, exponent: number, rotationDeg: number) => {
    const raw: Superellipse = { center, semiAxisX, semiAxisZ, exponent, rotationDeg };
    let scale = Infinity;
    for (const { deg, r } of radii) scale = Math.min(scale, r / superellipseRadius(raw, deg));
    const shape = { ...raw, semiAxisX: semiAxisX * scale, semiAxisZ: semiAxisZ * scale };
    let maxGap = 0;
    for (const { deg, r } of radii) maxGap = Math.max(maxGap, r - superellipseRadius(shape, deg));
    return { shape, maxGap };
  };
  const rMax = Math.max(...radii.map((d) => d.r));
  let best = evaluate(rMax, rMax, 2, 0);
  for (let ratio = 0.5; ratio <= 2.0001; ratio += 0.05) {
    for (let exponent = 1.6; exponent <= 5.0001; exponent += 0.2) {
      for (let rotationDeg = -45; rotationDeg < 45; rotationDeg += 2) {
        const candidate = evaluate(100, 100 * ratio, exponent, rotationDeg);
        if (candidate.maxGap < best.maxGap) best = candidate;
      }
    }
  }
  const coarse = best.shape;
  for (let dRatio = -0.05; dRatio <= 0.05001; dRatio += 0.005) {
    for (let dExp = -0.2; dExp <= 0.2001; dExp += 0.02) {
      for (let dRot = -2; dRot <= 2.0001; dRot += 0.25) {
        const candidate = evaluate(100, 100 * (coarse.semiAxisZ / coarse.semiAxisX + dRatio), coarse.exponent + dExp, coarse.rotationDeg + dRot);
        if (candidate.maxGap < best.maxGap) best = candidate;
      }
    }
  }
  return best;
}
