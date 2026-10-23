import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { CameraPose } from "../core/seat";
import { expectVec3Close } from "../test/helpers";
import { createSeatCamera, DEFAULT_FOV } from "./camera";
import { applyLook, clampLook, dragLook, isAhead, LOOK_AHEAD, LOOK_LIMITS, lookDirection, zoomedFov, zoomLook, type Look } from "./look";

/** 面向 +x、往下看 10°（像 I1-HP 第 1 排看本壘）。 */
const POSE: CameraPose = {
  position: { x: 0, y: 4, z: 0 },
  target: { x: 100 * Math.cos(THREE.MathUtils.degToRad(10)), y: 4 - 100 * Math.sin(THREE.MathUtils.degToRad(10)), z: 0 },
};
const look = (yawDeg: number, pitchDeg: number, zoom = 1): Look => ({ yawDeg, pitchDeg, zoom });

function cameraWith(pose: CameraPose, value: Look): THREE.PerspectiveCamera {
  const camera = createSeatCamera(16 / 9);
  applyLook(camera, pose, value, DEFAULT_FOV);
  return camera;
}

const project = (camera: THREE.PerspectiveCamera, p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z).project(camera);

describe("lookDirection / applyLook", () => {
  it("正視焦點：視線方向 = target − position，焦點在畫面正中央", () => {
    const { position, target } = POSE;
    const expected = new THREE.Vector3(target.x - position.x, target.y - position.y, target.z - position.z).normalize();
    expectVec3Close(lookDirection(POSE, LOOK_AHEAD), expected);
    const ndc = project(cameraWith(POSE, LOOK_AHEAD), target);
    expect(ndc.x).toBeCloseTo(0);
    expect(ndc.y).toBeCloseTo(0);
  });

  it("yaw 正值 = 往右轉：轉 30° 後，焦點出現在畫面左側（跟 core 的右手邊為正一致）", () => {
    expect(project(cameraWith(POSE, look(30, 0)), POSE.target).x).toBeLessThan(-0.1);
    expect(project(cameraWith(POSE, look(-30, 0)), POSE.target).x).toBeGreaterThan(0.1);
  });

  it("pitch 正值 = 往上看：抬頭 20° 後，焦點出現在畫面下方", () => {
    expect(project(cameraWith(POSE, look(0, 20)), POSE.target).y).toBeLessThan(-0.1);
  });

  it("相機位置不變、不側傾（右方向保持水平）", () => {
    const camera = cameraWith(POSE, look(70, 30, 2));
    expectVec3Close(camera.position, POSE.position);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    expect(right.y).toBeCloseTo(0);
  });

  it("放大 2 倍：FOV = 2·atan(tan(25°)/2)", () => {
    const camera = cameraWith(POSE, look(0, 0, 2));
    const expected = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(DEFAULT_FOV / 2)) / 2));
    expect(camera.fov).toBeCloseTo(expected);
    expect(zoomedFov(DEFAULT_FOV, 1)).toBeCloseTo(DEFAULT_FOV);
  });
});

describe("clampLook：轉頭範圍", () => {
  it(`左右 ±${LOOK_LIMITS.yawDeg}°；放大 1–${LOOK_LIMITS.maxZoom} 倍`, () => {
    expect(clampLook(POSE, look(200, 0)).yawDeg).toBe(LOOK_LIMITS.yawDeg);
    expect(clampLook(POSE, look(-200, 0)).yawDeg).toBe(-LOOK_LIMITS.yawDeg);
    expect(clampLook(POSE, look(0, 0, 9)).zoom).toBe(LOOK_LIMITS.maxZoom);
    expect(clampLook(POSE, look(0, 0, 0.2)).zoom).toBe(1);
  });

  it("上下限是絕對仰角：正視時往下 10°，所以 pitch 只能到 −35°（−45°）和 +70°（+60°）", () => {
    expect(clampLook(POSE, look(0, -90)).pitchDeg).toBeCloseTo(-35);
    expect(clampLook(POSE, look(0, 90)).pitchDeg).toBeCloseTo(70);
  });

  it("正視焦點一定在範圍內：焦點比 −45° 還低時，不會強迫抬頭", () => {
    const steep: CameraPose = { position: { x: 0, y: 50, z: 0 }, target: { x: 10, y: 0, z: 0 } };
    expect(clampLook(steep, LOOK_AHEAD)).toEqual(LOOK_AHEAD);
  });
});

describe("dragLook / zoomLook / isAhead", () => {
  it("像抓著畫面：往右拖 100 px（垂直視野 50°、畫面高 500 px）→ 往左轉 10°；往下拖 100 px → 抬頭 10°", () => {
    expect(dragLook(POSE, LOOK_AHEAD, 100, 0, 500, 50).yawDeg).toBeCloseTo(-10);
    expect(dragLook(POSE, LOOK_AHEAD, 0, 100, 500, 50).pitchDeg).toBeCloseTo(10);
  });

  it("拖曳的結果也受限制", () => {
    expect(dragLook(POSE, LOOK_AHEAD, -100000, 0, 500, 50).yawDeg).toBe(LOOK_LIMITS.yawDeg);
  });

  it("zoomLook 乘上倍率並受限制", () => {
    expect(zoomLook(POSE, LOOK_AHEAD, 2).zoom).toBeCloseTo(2);
    expect(zoomLook(POSE, look(0, 0, 3), 2).zoom).toBe(LOOK_LIMITS.maxZoom);
    expect(zoomLook(POSE, LOOK_AHEAD, 0.5).zoom).toBe(1);
  });

  it("isAhead：沒轉頭也沒放大才算正視", () => {
    expect(isAhead(LOOK_AHEAD)).toBe(true);
    expect(isAhead(look(0.5, 0))).toBe(false);
    expect(isAhead(look(0, 0, 1.2))).toBe(false);
  });
});
