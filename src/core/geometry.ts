import type { Focus, PlanPoint, Vec3 } from "./schema.ts";

export const DEG = 180 / Math.PI;
const EPSILON = 1e-9;

/** 3D 直線距離（m）。 */
export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 忽略高度的平面距離（m）。 */
export function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** 從 eye 看 target 的俯角（度）；正值代表 eye 比 target 高、往下看。 */
export function elevationAngle(eye: Vec3, target: Vec3): number {
  return Math.atan2(eye.y - target.y, horizontalDistance(eye, target)) * DEG;
}

/**
 * 座位相對舞台正面的水平偏角（度），範圍 (-180, 180]。
 * 0 = 正對；正值 = 觀眾面向舞台時的右手邊；180 = 舞台正後方；正上方回傳 0。
 */
export function horizontalAngle(eye: Vec3, focus: Focus): number {
  const dx = eye.x - focus.position.x;
  const dz = eye.z - focus.position.z;
  if (Math.hypot(dx, dz) < EPSILON) return 0;
  return normalizeDeg(focus.facingDeg - Math.atan2(dz, dx) * DEG);
}

/** 把角度換到 (-180, 180]。 */
export function normalizeDeg(deg: number): number {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  // 浮點誤差可能讓「正後方」算成 -179.999…，統一成 180
  return Math.abs(d + 180) < EPSILON ? 180 : d;
}

/**
 * 線段 from→to 的單位法向量中，指向遠離 away 那一側的那個。
 * from 與 to 重合，或 away 落在這條直線上時回傳 null（分不出哪邊是後方）。
 */
export function normalAwayFrom(from: PlanPoint, to: PlanPoint, away: PlanPoint): PlanPoint | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < EPSILON) return null;

  const nx = -dz / length;
  const nz = dx / length;
  // away 到直線的有號距離；正值代表 away 在法向量那一側
  const side = (away.x - from.x) * nx + (away.z - from.z) * nz;
  if (Math.abs(side) < EPSILON) return null;
  return side > 0 ? { x: -nx, z: -nz } : { x: nx, z: nz };
}
