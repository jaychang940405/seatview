import * as THREE from "three";
import type { CameraPose } from "../core/seat";

/** 預設 FOV（度），約等於手機主鏡頭（等效 26mm、3:2）。 */
export const DEFAULT_FOV = 50;

/**
 * 給 PerspectiveCamera.fov 用的垂直 FOV（度）。
 * 畫面比例 ≥ 1：baseFov 就是垂直 FOV。
 * 畫面比例 < 1（直式窄螢幕）：baseFov 改當水平 FOV，避免舞台左右被切掉。
 */
export function verticalFovFor(aspect: number, baseFov = DEFAULT_FOV): number {
  throw new Error("not implemented: verticalFovFor");
}

export function createSeatCamera(aspect: number, baseFov = DEFAULT_FOV): THREE.PerspectiveCamera {
  throw new Error("not implemented: createSeatCamera");
}

/** 視窗大小改變時呼叫：更新 aspect 與 FOV。 */
export function resizeSeatCamera(
  camera: THREE.PerspectiveCamera,
  aspect: number,
  baseFov = DEFAULT_FOV,
): void {
  throw new Error("not implemented: resizeSeatCamera");
}

/** 把 core 的 CameraPose 套到相機上：位置、看向 target、不側傾。 */
export function applyCameraPose(camera: THREE.PerspectiveCamera, pose: CameraPose): void {
  throw new Error("not implemented: applyCameraPose");
}
