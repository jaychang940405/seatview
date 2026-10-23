import type { PlanPoint, Shell, Vec3 } from "./schema.ts";

/*
 * 穹頂外殼的幾何（純函式）：屋頂高度與格柵線。render 只負責把它畫出來。
 * 屋頂外形是拋物面（C 級，依照片目視估計的外形，不是量測值）：
 * 從輪廓的面積形心往外，s = 距離 ÷ 那個方向到輪廓的距離，高度 = 牆頂 + (最高點 − 牆頂) × (1 − s²)。
 */

/** 格柵線沿線取樣的間隔（m）。 */
const LATTICE_SAMPLE = 1;

const centers = new WeakMap<Shell, PlanPoint>();

/** 底面輪廓的面積形心（屋頂最高點的平面位置）。 */
export function shellCenter(shell: Shell): PlanPoint {
  const cached = centers.get(shell);
  if (cached) return cached;
  let area = 0;
  let cx = 0;
  let cz = 0;
  shell.outline.forEach((p, i) => {
    const q = shell.outline[(i + 1) % shell.outline.length] as PlanPoint;
    const cross = p.x * q.z - q.x * p.z;
    area += cross;
    cx += (p.x + q.x) * cross;
    cz += (p.z + q.z) * cross;
  });
  const center = { x: cx / (3 * area), z: cz / (3 * area) };
  centers.set(shell, center);
  return center;
}

/** 從 from 沿單位方向 (dx, dz) 走到輪廓的距離（輪廓是凸的，取最近的交點）。 */
function distanceToOutline(outline: PlanPoint[], from: PlanPoint, dx: number, dz: number): number {
  let nearest = Infinity;
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length] as PlanPoint;
    const [ex, ez] = [b.x - a.x, b.z - a.z];
    const denominator = dx * ez - dz * ex;
    if (Math.abs(denominator) < 1e-12) return;
    const [wx, wz] = [a.x - from.x, a.z - from.z];
    const t = (wx * ez - wz * ex) / denominator;
    const u = (wx * dz - wz * dx) / denominator;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) nearest = Math.min(nearest, t);
  });
  return nearest;
}

/** 屋頂在平面位置 p 的高度；p 在輪廓外時當作在輪廓上（= 牆頂）。 */
export function roofHeightAt(shell: Shell, p: PlanPoint): number {
  const center = shellCenter(shell);
  const [dx, dz] = [p.x - center.x, p.z - center.z];
  const r = Math.hypot(dx, dz);
  if (r < 1e-9) return shell.roofHeight;
  const s = Math.min(1, r / distanceToOutline(shell.outline, center, dx / r, dz / r));
  return shell.wallHeight + (shell.roofHeight - shell.wallHeight) * (1 - s * s);
}

function pointInPolygon(polygon: PlanPoint[], p: PlanPoint): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as PlanPoint;
    const b = polygon[j] as PlanPoint;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** 屋頂的菱形格柵：平面上 ±45° 兩組、間距 spacing 的平行線，抬到屋頂高度；只保留輪廓內的點。 */
export function roofLattice(shell: Shell, spacing: number): Vec3[][] {
  const center = shellCenter(shell);
  const reach = Math.max(...shell.outline.map((p) => Math.hypot(p.x - center.x, p.z - center.z)));
  const lines: Vec3[][] = [];
  const s = Math.SQRT1_2;
  // 兩組線：方向 (1, 1) 與 (1, −1)；每條線從形心沿法向量平移 k × spacing
  for (const [direction, normal] of [
    [{ x: s, z: s }, { x: s, z: -s }],
    [{ x: s, z: -s }, { x: s, z: s }],
  ] as const) {
    const count = Math.ceil(reach / spacing);
    for (let k = -count; k <= count; k++) {
      const base = { x: center.x + normal.x * k * spacing, z: center.z + normal.z * k * spacing };
      let run: Vec3[] = [];
      for (let t = -reach; t <= reach; t += LATTICE_SAMPLE) {
        const p = { x: base.x + direction.x * t, z: base.z + direction.z * t };
        if (pointInPolygon(shell.outline, p)) {
          run.push({ x: p.x, y: roofHeightAt(shell, p), z: p.z });
        } else if (run.length > 0) {
          if (run.length >= 2) lines.push(run);
          run = [];
        }
      }
      if (run.length >= 2) lines.push(run);
    }
  }
  return lines;
}
