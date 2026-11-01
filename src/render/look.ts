import * as THREE from "three";
import type { CameraPose } from "../core/seat";
import { verticalFovFor } from "./camera";

/** 從座位轉頭的範圍與倍數。 */
export const LOOK_LIMITS = { yawDeg: 120, minPitchDeg: -45, maxPitchDeg: 60, minZoom: 0.5, maxZoom: 4 } as const;

/** 預設倍數：1×（0.5× ≈ 等效 13 mm 廣角保留為按鈕）。 */
export const DEFAULT_ZOOM = 1;
/** 「人眼」那一檔：約 1.7×（C 級，等效約 44 mm 的標準鏡頭量級，不是量測值）。 */
export const HUMAN_EYE_ZOOM = 1.7;
export const ZOOM_PRESETS = [
  { label: "0.5×", zoom: 0.5 },
  { label: "1×", zoom: 1 },
  { label: "人眼", zoom: HUMAN_EYE_ZOOM },
] as const;

export function isFacingFocus(look: Look): boolean {
  return look.yawDeg === 0 && look.pitchDeg === 0;
}

/** 回正：方向轉回正視焦點，倍數不變。 */
export function faceFocus(look: Look): Look {
  return { ...look, yawDeg: 0, pitchDeg: 0 };
}

/** 座位相機的垂直 FOV：直式窄螢幕以水平 FOV 為基準（verticalFovFor），再套倍數。 */
export function seatFov(aspect: number, zoom: number, baseFov: number): number {
  return zoomedFov(verticalFovFor(aspect, baseFov), zoom);
}

/** 倍數的說明，以「人眼」那一檔為基準。 */
export function zoomNote(zoom: number): string {
  if (Math.abs(zoom - HUMAN_EYE_ZOOM) < 0.05) return "約等於肉眼";
  return zoom < HUMAN_EYE_ZOOM ? "比肉眼看起來小、遠" : "比肉眼看起來大、近";
}

/**
 * 相對於「正視焦點」的轉頭量。
 * yawDeg 正值 = 往右轉（跟 core horizontalAngle「右手邊為正」一致）；pitchDeg 正值 = 往上看；zoom 0.5–4。
 * 距離、角度等數據一律以正視焦點計算，轉頭只改變畫面。
 */
export interface Look {
  yawDeg: number;
  pitchDeg: number;
  zoom: number;
}

/** 正視焦點、預設倍數。 */
export const LOOK_AHEAD: Look = { yawDeg: 0, pitchDeg: 0, zoom: DEFAULT_ZOOM };

/** 正視焦點的方向：yaw 是平面角度（從 +x 轉向 +z），pitch 是仰角（往上為正），單位度。 */
function aheadAngles(pose: CameraPose): { yawDeg: number; pitchDeg: number } {
  const dx = pose.target.x - pose.position.x;
  const dy = pose.target.y - pose.position.y;
  const dz = pose.target.z - pose.position.z;
  return {
    yawDeg: THREE.MathUtils.radToDeg(Math.atan2(dz, dx)),
    pitchDeg: THREE.MathUtils.radToDeg(Math.atan2(dy, Math.hypot(dx, dz))),
  };
}

/** 套用限制：左右 ±120°；絕對仰角 −45°～+60°（但一定容許正視焦點）；倍數 0.5–4×。 */
export function clampLook(pose: CameraPose, look: Look): Look {
  const ahead = aheadAngles(pose).pitchDeg;
  return {
    yawDeg: THREE.MathUtils.clamp(look.yawDeg, -LOOK_LIMITS.yawDeg, LOOK_LIMITS.yawDeg),
    pitchDeg: THREE.MathUtils.clamp(look.pitchDeg, Math.min(0, LOOK_LIMITS.minPitchDeg - ahead), Math.max(0, LOOK_LIMITS.maxPitchDeg - ahead)),
    zoom: THREE.MathUtils.clamp(look.zoom, LOOK_LIMITS.minZoom, LOOK_LIMITS.maxZoom),
  };
}

/** 拖曳 dx、dy 像素，像抓著畫面移動：往右拖 → 看向左邊；往下拖 → 看向上方。每像素的角度 = 目前垂直視野 / 畫面高度。 */
export function dragLook(pose: CameraPose, look: Look, dxPx: number, dyPx: number, viewportHeightPx: number, verticalFovDeg: number): Look {
  const degPerPx = verticalFovDeg / viewportHeightPx;
  return clampLook(pose, { ...look, yawDeg: look.yawDeg - dxPx * degPerPx, pitchDeg: look.pitchDeg + dyPx * degPerPx });
}

/** 放大：factor > 1 拉近、< 1 拉遠。 */
export function zoomLook(pose: CameraPose, look: Look, factor: number): Look {
  return clampLook(pose, { ...look, zoom: look.zoom * factor });
}

/** 視線方向（單位向量）。往右轉 = 平面角度增加（面向 +x 時右手邊是 +z）。 */
export function lookDirection(pose: CameraPose, look: Look): THREE.Vector3 {
  const ahead = aheadAngles(pose);
  const yaw = THREE.MathUtils.degToRad(ahead.yawDeg + look.yawDeg);
  const pitch = THREE.MathUtils.degToRad(ahead.pitchDeg + look.pitchDeg);
  return new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
}

/** 放大後的垂直視野（度）：tan(fov/2) 縮小 zoom 倍。 */
export function zoomedFov(verticalFovDeg: number, zoom: number): number {
  const half = THREE.MathUtils.degToRad(verticalFovDeg) / 2;
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / zoom));
}

/** 相機放在 pose.position、看向 lookDirection、不側傾，FOV 依 zoom 調整。baseVerticalFov 是沒放大時的垂直 FOV。 */
export function applyLook(camera: THREE.PerspectiveCamera, pose: CameraPose, look: Look, baseVerticalFov: number): void {
  const { position } = pose;
  const direction = lookDirection(pose, look);
  camera.position.set(position.x, position.y, position.z);
  camera.up.set(0, 1, 0);
  camera.lookAt(position.x + direction.x, position.y + direction.y, position.z + direction.z);
  camera.fov = zoomedFov(baseVerticalFov, look.zoom);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
