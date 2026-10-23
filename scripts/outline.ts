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

/** 從中心沿 deg 方向到超橢圓邊界的距離。 */
export function superellipseRadius(shape: Superellipse, deg: number): number {
  throw new Error("not implemented: superellipseRadius");
}

/** 每 stepDeg 取一點連成的多邊形；超橢圓是凸的，所以多邊形內接於曲線（偏保守）。 */
export function superellipsePolygon(shape: Superellipse, stepDeg = 1): PlanPoint[] {
  throw new Error("not implemented: superellipsePolygon");
}

export function pointInPolygon(polygon: PlanPoint[], p: PlanPoint): boolean {
  throw new Error("not implemented: pointInPolygon");
}

/** 正值 = 在多邊形內、離邊界多遠；負值 = 超出多遠。 */
export function signedDistance(polygon: PlanPoint[], p: PlanPoint): number {
  throw new Error("not implemented: signedDistance");
}

/** 凸多邊形往內縮 margin（每條邊往內平移後，相鄰兩邊求交點）。 */
export function insetConvexPolygon(polygon: PlanPoint[], margin: number): PlanPoint[] {
  throw new Error("not implemented: insetConvexPolygon");
}

/**
 * 對「相對 center 是星形」的多邊形做快速內外判斷：預先算好每 stepDeg 的邊界距離，判斷時查表。
 * 擬合搜尋要判斷上千萬次，逐邊計算太慢。
 */
export function radialChecker(polygon: PlanPoint[], center: PlanPoint, stepDeg = 0.25): (p: PlanPoint) => boolean {
  throw new Error("not implemented: radialChecker");
}

/** 多邊形的面積形心（不是頂點平均：頂點分布不均時兩者會差好幾公尺）。 */
export function areaCentroid(polygon: PlanPoint[]): PlanPoint {
  throw new Error("not implemented: areaCentroid");
}

/**
 * 給定中心到真實邊界的距離（每個方向一筆），找出內接（不超出）且最貼近的超橢圓。
 * 回傳參數與最大內縮差距（真實邊界比超橢圓多出來的最大距離）。
 */
export function fitInscribedSuperellipse(
  radii: { deg: number; r: number }[],
  center: PlanPoint,
): { shape: Superellipse; maxGap: number } {
  throw new Error("not implemented: fitInscribedSuperellipse");
}
