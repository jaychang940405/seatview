import * as THREE from "three";
import type { Venue } from "../core/schema";

/** 座位方塊尺寸（m）。本地 +x 是座位面向的方向。 */
export const SEAT_SIZE = { depth: 0.5, height: 0.45, width: 0.5 } as const;

export interface SectionMesh {
  sectionId: string;
  /** name = "section:<sectionId>"，一個 instance 一個座位，順序同 sectionSeats */
  mesh: THREE.InstancedMesh;
  baseColor: THREE.Color;
  /** (row, seat) → instance index；沒有這個座位回傳 undefined */
  indexOf(row: number, seat: number): number | undefined;
}

/** 一區畫成一個 InstancedMesh；位置與朝向全部來自 core 的 sectionSeats。 */
export function buildSectionMesh(
  venue: Venue,
  sectionId: string,
  color: THREE.ColorRepresentation,
): SectionMesh {
  throw new Error("not implemented: buildSectionMesh");
}
