import * as THREE from "three";
import type { Vec3, Venue } from "../core/schema";

/** 各區輪流使用的顏色（Paul Tol bright，扣掉留給選位的紅色）。 */
export const SECTION_COLORS = ["#4477aa", "#66ccee", "#228833", "#ccbb44", "#aa3377", "#bbbbbb"];
export const HIGHLIGHT_COLOR = new THREE.Color("#ee6677");

export interface SeatRef {
  sectionId: string;
  row: number;
  seat: number;
}

export interface VenueScene {
  scene: THREE.Scene;
  /** layout 的 focus（鳥瞰相機繞著它轉） */
  focus: Vec3;
  /** 把一個座位換成 HIGHLIGHT_COLOR；傳 null 或找不到的座位就只清除舊的 */
  highlightSeat(ref: SeatRef | null): void;
  dispose(): void;
}

/** 組出一個 layout 的場景：開放的區、overlays、地板、燈光。 */
export function buildVenueScene(venue: Venue, layoutId: string): VenueScene {
  throw new Error("not implemented: buildVenueScene");
}
