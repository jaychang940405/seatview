import * as THREE from "three";
import type { Vec3 } from "../core/schema";

// core 的座標系（Y 向上、平面圖 z 向下）就是 three.js 的世界座標，位置不用轉換。

export function toVector3(v: Vec3): THREE.Vector3 {
  throw new Error("not implemented: toVector3");
}

/**
 * 平面角度（從 +x 轉向 +z）→ Object3D.rotation.y（弧度）。
 * 套用後，物件本地的 +x 軸會指向 yawDeg 方向。
 */
export function planYawToRotationY(yawDeg: number): number {
  throw new Error("not implemented: planYawToRotationY");
}
