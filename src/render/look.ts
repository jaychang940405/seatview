import * as THREE from "three";
import type { CameraPose } from "../core/seat";

/** 從座位轉頭的範圍與放大倍率。 */
export const LOOK_LIMITS = { yawDeg: 120, minPitchDeg: -45, maxPitchDeg: 60, maxZoom: 4 } as const;

/**
 * 相對於「正視焦點」的轉頭量。
 * yawDeg 正值 = 往右轉（跟 core horizontalAngle「右手邊為正」一致）；pitchDeg 正值 = 往上看；zoom ≥ 1。
 * 距離、角度等數據一律以正視焦點計算，轉頭只改變畫面。
 */
export interface Look {
  yawDeg: number;
  pitchDeg: number;
  zoom: number;
}

export const LOOK_AHEAD: Look = { yawDeg: 0, pitchDeg: 0, zoom: 1 };

export function isAhead(_look: Look): boolean {
  throw new Error("not implemented");
}

/** 套用限制：左右 ±120°；絕對仰角 −45°～+60°（但一定容許正視焦點）；放大 1–4 倍。 */
export function clampLook(_pose: CameraPose, _look: Look): Look {
  throw new Error("not implemented");
}

/** 拖曳 dx、dy 像素，像抓著畫面移動：往右拖 → 看向左邊；往下拖 → 看向上方。每像素的角度 = 目前垂直視野 / 畫面高度。 */
export function dragLook(_pose: CameraPose, _look: Look, _dxPx: number, _dyPx: number, _viewportHeightPx: number, _verticalFovDeg: number): Look {
  throw new Error("not implemented");
}

/** 放大：factor > 1 拉近、< 1 拉遠。 */
export function zoomLook(_pose: CameraPose, _look: Look, _factor: number): Look {
  throw new Error("not implemented");
}

/** 視線方向（單位向量）。 */
export function lookDirection(_pose: CameraPose, _look: Look): THREE.Vector3 {
  throw new Error("not implemented");
}

/** 放大後的垂直視野（度）：tan(fov/2) 縮小 zoom 倍。 */
export function zoomedFov(_verticalFovDeg: number, _zoom: number): number {
  throw new Error("not implemented");
}

/** 相機放在 pose.position、看向 lookDirection、不側傾，FOV 依 zoom 調整。baseVerticalFov 是沒放大時的垂直 FOV。 */
export function applyLook(_camera: THREE.PerspectiveCamera, _pose: CameraPose, _look: Look, _baseVerticalFov: number): void {
  throw new Error("not implemented");
}
