import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseVenue } from "../core/schema";
import { getSeatView } from "../core/view";
import demoArenaJson from "../venues/demo-arena.json";
import { expectVec3Close } from "../test/helpers";
import {
  applyCameraPose,
  createSeatCamera,
  DEFAULT_FOV,
  resizeSeatCamera,
  verticalFovFor,
} from "./camera";

const demo = () => parseVenue(demoArenaJson);

/** 由垂直 FOV 與畫面比例算出水平 FOV（度）。 */
function horizontalFov(verticalDeg: number, aspect: number): number {
  const half = THREE.MathUtils.degToRad(verticalDeg) / 2;
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) * aspect));
}

/** 相機在原點看向 -z，水平偏右 offDeg 度、10 m 外的點投影到 NDC。 */
function projectOffAxis(camera: THREE.PerspectiveCamera, offDeg: number): THREE.Vector3 {
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld();
  const rad = THREE.MathUtils.degToRad(offDeg);
  return new THREE.Vector3(10 * Math.sin(rad), 0, -10 * Math.cos(rad)).project(camera);
}

describe("verticalFovFor", () => {
  it.each([16 / 9, 4 / 3, 1])("畫面比例 %s（≥ 1）→ 垂直 FOV 就是 50°", (aspect) => {
    expect(verticalFovFor(aspect)).toBeCloseTo(DEFAULT_FOV);
  });

  it.each([0.5, 9 / 16, 0.75])("畫面比例 %s（< 1）→ 水平 FOV 固定 50°", (aspect) => {
    expect(horizontalFov(verticalFovFor(aspect), aspect)).toBeCloseTo(DEFAULT_FOV);
  });

  it("在比例 1 前後連續，縮放視窗時畫面不會跳", () => {
    expect(verticalFovFor(0.999)).toBeCloseTo(verticalFovFor(1.001), 1);
  });

  it("可以指定其他 baseFov", () => {
    expect(verticalFovFor(2, 60)).toBeCloseTo(60);
    expect(horizontalFov(verticalFovFor(0.5, 60), 0.5)).toBeCloseTo(60);
  });
});

describe("窄螢幕不切掉舞台", () => {
  it("直式 9:16：水平偏 24° 的點仍在畫面內", () => {
    const aspect = 9 / 16;
    // 對照組：垂直 FOV 固定 50° 時，這個點會被切到畫面外
    const naive = new THREE.PerspectiveCamera(DEFAULT_FOV, aspect, 0.1, 100);
    expect(Math.abs(projectOffAxis(naive, 24).x)).toBeGreaterThan(1);

    expect(Math.abs(projectOffAxis(createSeatCamera(aspect), 24).x)).toBeLessThan(1);
  });
});

describe("createSeatCamera / resizeSeatCamera", () => {
  it("建立時就套用比例與 FOV", () => {
    const camera = createSeatCamera(0.5);
    expect(camera.aspect).toBe(0.5);
    expect(camera.fov).toBeCloseTo(verticalFovFor(0.5));
  });

  it("resize 後跟直接用新比例建立的相機投影一致", () => {
    const camera = createSeatCamera(16 / 9);
    resizeSeatCamera(camera, 0.5);
    expect(camera.aspect).toBe(0.5);
    expect(camera.fov).toBeCloseTo(verticalFovFor(0.5));
    const expected = createSeatCamera(0.5).projectionMatrix.elements;
    camera.projectionMatrix.elements.forEach((value, i) => expect(value).toBeCloseTo(expected[i] ?? NaN));
  });
});

describe("applyCameraPose", () => {
  const pose = () => getSeatView(demo(), "concert", "A1", 1, 16).camera;

  it("相機位置 = pose.position", () => {
    const camera = createSeatCamera(16 / 9);
    applyCameraPose(camera, pose());
    expectVec3Close(camera.position, { x: 0, y: 4.2, z: 30 });
  });

  it("視線方向 = target − position", () => {
    const camera = createSeatCamera(16 / 9);
    const { position, target } = pose();
    applyCameraPose(camera, pose());
    const expected = new THREE.Vector3(target.x - position.x, target.y - position.y, target.z - position.z).normalize();
    expectVec3Close(camera.getWorldDirection(new THREE.Vector3()), expected);
  });

  it("focus 投影在畫面正中央（NDC ≈ (0, 0)）", () => {
    const camera = createSeatCamera(16 / 9);
    const { target } = pose();
    applyCameraPose(camera, pose());
    const ndc = new THREE.Vector3(target.x, target.y, target.z).project(camera);
    expect(ndc.x).toBeCloseTo(0);
    expect(ndc.y).toBeCloseTo(0);
  });

  it("不側傾：相機的右方向保持水平", () => {
    const camera = createSeatCamera(16 / 9);
    applyCameraPose(camera, getSeatView(demo(), "concert", "B1", 15, 1).camera);
    const right = new THREE.Vector3(1, 0, 0).transformDirection(camera.matrixWorld);
    expect(right.y).toBeCloseTo(0);
  });

  it("不修改傳入的 pose", () => {
    const camera = createSeatCamera(16 / 9);
    const original = pose();
    const copy = structuredClone(original);
    applyCameraPose(camera, original);
    expect(original).toEqual(copy);
  });
});
