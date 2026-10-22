import type { Focus, Vec3 } from "./schema";

/** 3D 直線距離（m）。 */
export function distance(a: Vec3, b: Vec3): number {
  throw new Error("not implemented: distance");
}

/** 忽略高度的平面距離（m）。 */
export function horizontalDistance(a: Vec3, b: Vec3): number {
  throw new Error("not implemented: horizontalDistance");
}

/** 從 eye 看 target 的俯角（度）；正值代表 eye 比 target 高、往下看。 */
export function elevationAngle(eye: Vec3, target: Vec3): number {
  throw new Error("not implemented: elevationAngle");
}

/**
 * 座位相對舞台正面的水平偏角（度），範圍 (-180, 180]。
 * 0 = 正對；正值 = 觀眾面向舞台時的右手邊；180 = 舞台正後方；正上方回傳 0。
 */
export function horizontalAngle(eye: Vec3, focus: Focus): number {
  throw new Error("not implemented: horizontalAngle");
}
