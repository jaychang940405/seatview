import * as THREE from "three";
import type { Vec3 } from "../core/schema";

// core 的座標系（Y 向上、平面圖 z 向下）就是 three.js 的世界座標，位置不用轉換。

export function toVector3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

/**
 * 平面角度（從 +x 轉向 +z）→ Object3D.rotation.y（弧度）。
 * 套用後，物件本地的 +x 軸會指向 yawDeg 方向。
 */
export function planYawToRotationY(yawDeg: number): number {
  // three.js 的正 rotation.y 會把 +x 轉向 -z，跟平面角度相反
  return -THREE.MathUtils.degToRad(yawDeg);
}
