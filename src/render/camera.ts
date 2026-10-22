import * as THREE from "three";
import type { CameraPose } from "../core/seat";

/** 預設 FOV（度），約等於手機主鏡頭（等效 26mm、3:2）。 */
export const DEFAULT_FOV = 50;
const NEAR = 0.1;
const FAR = 2000;

/**
 * 給 PerspectiveCamera.fov 用的垂直 FOV（度）。
 * 畫面比例 ≥ 1：baseFov 就是垂直 FOV。
 * 畫面比例 < 1（直式窄螢幕）：baseFov 改當水平 FOV，避免舞台左右被切掉。
 */
export function verticalFovFor(aspect: number, baseFov = DEFAULT_FOV): number {
  if (aspect >= 1) return baseFov;
  const halfHorizontal = THREE.MathUtils.degToRad(baseFov) / 2;
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfHorizontal) / aspect));
}

export function createSeatCamera(aspect: number, baseFov = DEFAULT_FOV): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(verticalFovFor(aspect, baseFov), aspect, NEAR, FAR);
}

/** 視窗大小改變時呼叫：更新 aspect 與 FOV。 */
export function resizeSeatCamera(
  camera: THREE.PerspectiveCamera,
  aspect: number,
  baseFov = DEFAULT_FOV,
): void {
  camera.aspect = aspect;
  camera.fov = verticalFovFor(aspect, baseFov);
  camera.updateProjectionMatrix();
}

/** 把 core 的 CameraPose 套到相機上：位置、看向 target、不側傾。 */
export function applyCameraPose(camera: THREE.PerspectiveCamera, pose: CameraPose): void {
  const { position, target } = pose;
  camera.position.set(position.x, position.y, position.z);
  camera.up.set(0, 1, 0);
  camera.lookAt(target.x, target.y, target.z);
  camera.updateMatrixWorld();
}
