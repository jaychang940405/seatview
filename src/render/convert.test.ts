import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { expectVec3Close } from "../test/helpers";
import { planYawToRotationY, toVector3 } from "./convert";

/** 套用 yaw 後，物件本地 +x 軸在世界座標中指向哪裡。 */
function localXAfterYaw(yawDeg: number): THREE.Vector3 {
  const object = new THREE.Object3D();
  object.rotation.y = planYawToRotationY(yawDeg);
  object.updateMatrixWorld();
  return new THREE.Vector3(1, 0, 0).transformDirection(object.matrixWorld);
}

describe("toVector3", () => {
  it("數值不變，回傳 THREE.Vector3", () => {
    const v = toVector3({ x: 1, y: 2, z: 3 });
    expect(v).toBeInstanceOf(THREE.Vector3);
    expect(v.toArray()).toEqual([1, 2, 3]);
  });
});

describe("planYawToRotationY", () => {
  it("yaw 0 → 不旋轉", () => {
    expect(planYawToRotationY(0)).toBeCloseTo(0);
  });

  // 平面角度從 +x 轉向 +z；three.js 的正 rotation.y 方向相反（+x 轉向 -z），最容易寫反
  it.each([
    [90, { x: 0, y: 0, z: 1 }],
    [180, { x: -1, y: 0, z: 0 }],
    [-90, { x: 0, y: 0, z: -1 }],
    [45, { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 }],
  ])("yaw %s° → 本地 +x 指向 %o", (yawDeg, expected) => {
    expectVec3Close(localXAfterYaw(yawDeg), expected);
  });
});
