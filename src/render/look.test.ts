import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { CameraPose } from "../core/seat";
import { expectVec3Close } from "../test/helpers";
import { createSeatCamera, DEFAULT_FOV } from "./camera";
import { verticalFovFor } from "./camera";
import {
  applyLook,
  clampLook,
  DEFAULT_ZOOM,
  dragLook,
  faceFocus,
  HUMAN_EYE_ZOOM,
  isFacingFocus,
  LOOK_AHEAD,
  LOOK_LIMITS,
  lookDirection,
  seatFov,
  ZOOM_PRESETS,
  zoomedFov,
  zoomLook,
  zoomNote,
  type Look,
} from "./look";

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
  it(`左右 ±${LOOK_LIMITS.yawDeg}°；倍數 ${LOOK_LIMITS.minZoom}–${LOOK_LIMITS.maxZoom}×`, () => {
    expect(clampLook(POSE, look(200, 0)).yawDeg).toBe(LOOK_LIMITS.yawDeg);
    expect(clampLook(POSE, look(-200, 0)).yawDeg).toBe(-LOOK_LIMITS.yawDeg);
    expect(clampLook(POSE, look(0, 0, 9)).zoom).toBe(LOOK_LIMITS.maxZoom);
    expect(clampLook(POSE, look(0, 0, 0.2)).zoom).toBe(LOOK_LIMITS.minZoom);
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

describe("dragLook / zoomLook / 回正", () => {
  it("像抓著畫面：往右拖 100 px（垂直視野 50°、畫面高 500 px）→ 往左轉 10°；往下拖 100 px → 抬頭 10°", () => {
    expect(dragLook(POSE, LOOK_AHEAD, 100, 0, 500, 50).yawDeg).toBeCloseTo(-10);
    expect(dragLook(POSE, LOOK_AHEAD, 0, 100, 500, 50).pitchDeg).toBeCloseTo(10);
  });

  it("拖曳的結果也受限制", () => {
    expect(dragLook(POSE, LOOK_AHEAD, -100000, 0, 500, 50).yawDeg).toBe(LOOK_LIMITS.yawDeg);
  });

  it("zoomLook 乘上倍率並受限制", () => {
    expect(zoomLook(POSE, look(0, 0, 1), 2).zoom).toBeCloseTo(2);
    expect(zoomLook(POSE, look(0, 0, 3), 2).zoom).toBe(LOOK_LIMITS.maxZoom);
    expect(zoomLook(POSE, look(0, 0, 0.6), 0.5).zoom).toBe(LOOK_LIMITS.minZoom);
  });

  it("回正只重設方向、保留倍數；正視與否只看方向", () => {
    expect(faceFocus(look(40, -10, 1.7))).toEqual(look(0, 0, 1.7));
    expect(isFacingFocus(look(0, 0, 3))).toBe(true);
    expect(isFacingFocus(look(0.5, 0))).toBe(false);
    expect(isFacingFocus(look(0, -2))).toBe(false);
  });
});

describe("倍數（FOV）：tan(fov/2) = tan(base/2) / zoom，1× = 垂直 50°（等效 26 mm）", () => {
  it.each([
    [0.5, 86.0],
    [1, 50.0],
    [1.7, 30.7],
    [4, 13.3],
  ])("%s× → 垂直 FOV %s°", (zoom, fov) => {
    expect(zoomedFov(DEFAULT_FOV, zoom)).toBeCloseTo(fov, 1);
  });

  it("預設 0.5×（約等效 13 mm）；預設按鈕 0.5×、1×、人眼（約 1.7×，C 級）", () => {
    expect(DEFAULT_ZOOM).toBe(0.5);
    expect(LOOK_AHEAD.zoom).toBe(DEFAULT_ZOOM);
    expect(HUMAN_EYE_ZOOM).toBeCloseTo(1.7);
    expect(ZOOM_PRESETS.map((p) => p.zoom)).toEqual([0.5, 1, HUMAN_EYE_ZOOM]);
    expect(ZOOM_PRESETS.map((p) => p.label)).toEqual(["0.5×", "1×", "人眼"]);
  });

  it("直式窄螢幕：倍數套在「水平 FOV 為基準」之上，比例 1 前後連續", () => {
    for (const zoom of [0.5, 1, 1.7, 4]) {
      expect(seatFov(1 - 1e-9, zoom, DEFAULT_FOV)).toBeCloseTo(seatFov(1 + 1e-9, zoom, DEFAULT_FOV), 6);
      expect(seatFov(16 / 9, zoom, DEFAULT_FOV)).toBeCloseTo(zoomedFov(DEFAULT_FOV, zoom), 9);
    }
  });

  it("直式 9:16：水平 FOV = 以 50° 為基準縮放（0.5× → 水平 86°）", () => {
    const aspect = 9 / 16;
    for (const zoom of [0.5, 1, 1.7]) {
      const vertical = THREE.MathUtils.degToRad(seatFov(aspect, zoom, DEFAULT_FOV));
      const horizontal = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(vertical / 2) * aspect));
      expect(horizontal).toBeCloseTo(zoomedFov(DEFAULT_FOV, zoom), 6);
    }
    expect(seatFov(aspect, 1, DEFAULT_FOV)).toBeCloseTo(verticalFovFor(aspect), 9);
  });

  it("倍數說明以「人眼」那一檔為基準", () => {
    expect(zoomNote(0.5)).toBe("比肉眼看起來小、遠");
    expect(zoomNote(1)).toBe("比肉眼看起來小、遠");
    expect(zoomNote(HUMAN_EYE_ZOOM)).toBe("約等於肉眼");
    expect(zoomNote(3)).toBe("比肉眼看起來大、近");
  });
});
