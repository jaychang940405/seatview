import type { PlanPoint, Shell, Vec3 } from "./schema.ts";

/*
 * 穹頂外殼的幾何（純函式）：屋頂高度與格柵線。render 只負責把它畫出來。
 * 屋頂外形是拋物面（C 級，依照片目視估計的外形，不是量測值）：
 * 從輪廓的面積形心往外，s = 距離 ÷ 那個方向到輪廓的距離，高度 = 牆頂 + (最高點 − 牆頂) × (1 − s²)。
 */

/** 底面輪廓的面積形心（屋頂最高點的平面位置）。 */
export function shellCenter(_shell: Shell): PlanPoint {
  throw new Error("not implemented");
}

/** 屋頂在平面位置 p 的高度；p 在輪廓外時當作在輪廓上（= 牆頂）。 */
export function roofHeightAt(_shell: Shell, _p: PlanPoint): number {
  throw new Error("not implemented");
}

/** 屋頂的菱形格柵：平面上 ±45° 兩組、間距 spacing 的平行線，抬到屋頂高度；只保留輪廓內的點。 */
export function roofLattice(_shell: Shell, _spacing: number): Vec3[][] {
  throw new Error("not implemented");
}
