import type { PlanPoint, Venue } from "../core/schema";

/*
 * 小地圖的資料（純函式，不碰 DOM）：取代鳥瞰的選位功能。
 * 區的輪廓來自 core 的 sectionOutline，選中座位的位置來自 core 的 seatPosition；這裡不重算幾何。
 * 平面座標 x 向右、z 向下，剛好就是 SVG 的座標方向。
 */

export interface MinimapSection {
  id: string;
  label: string;
  points: PlanPoint[];
  /** SVG path："M x z L x z … Z" */
  path: string;
  /** 點這一區時跳到的座位：排取中間、號取那一排的中間 */
  target: { row: number; seat: number };
}

export interface MinimapModel {
  /** SVG viewBox："minX minZ width height"，包住所有區與線條並留邊 */
  viewBox: string;
  sections: MinimapSection[];
  /** layout 的折線 overlay（界外線、外野牆…），只當方位參考 */
  lines: { id: string; path: string }[];
  selected: { sectionId: string; point: PlanPoint } | null;
}

export function buildMinimapModel(
  _venue: Venue,
  _layoutId: string,
  _selected: { sectionId: string; row: number; seat: number } | null,
): MinimapModel {
  throw new Error("not implemented");
}
