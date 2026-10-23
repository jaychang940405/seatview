import * as THREE from "three";
import type { Venue } from "../core/schema";
import { sectionSeats } from "../core/seat";
import { planYawToRotationY, toVector3 } from "./convert";

/** 座位方塊尺寸（m）。本地 +x 是座位面向的方向。 */
export const SEAT_SIZE = { depth: 0.5, height: 0.45, width: 0.5 } as const;

/**
 * 座椅尺寸（m）。C 級：一般體育場座椅的規格，不是大巨蛋的量測值。
 * 本地 +x 是座位面向的方向，原點在座位地面中心（= core 的座位位置）。
 */
export const CHAIR = {
  width: 0.44,
  /** 椅面頂的高度 */
  seatHeight: 0.43,
  seatDepth: 0.42,
  seatThickness: 0.06,
  /** 椅背頂的高度（椅背往後傾） */
  backTop: 0.82,
  backThickness: 0.06,
  backTiltDeg: 8,
} as const;

/** 座位視角的椅子顏色：中性的深藍灰，不假裝是大巨蛋的實際配色。 */
export const SEAT_NEUTRAL = new THREE.Color("#3b4d61");
/** 鳥瞰時混入多少分區色（0 = 全中性、1 = 全分區色）。 */
export const OVERVIEW_TINT = 0.5;

export type ColorMode = "seat" | "overview";

export function chairGeometry(): THREE.BufferGeometry {
  throw new Error("not implemented");
}

export interface SectionMesh {
  sectionId: string;
  /** name = "section:<sectionId>"，一個 instance 一個座位，順序同 sectionSeats */
  mesh: THREE.InstancedMesh;
  baseColor: THREE.Color;
  /** 各模式下的椅子顏色 */
  colors: Record<ColorMode, THREE.Color>;
  /** 把每個 instance 換成該模式的顏色 */
  paint(mode: ColorMode): void;
  /** (row, seat) → instance index；沒有這個座位回傳 undefined */
  indexOf(row: number, seat: number): number | undefined;
}

/** 一區畫成一個 InstancedMesh；位置與朝向全部來自 core 的 sectionSeats。 */
export function buildSectionMesh(
  venue: Venue,
  sectionId: string,
  color: THREE.ColorRepresentation,
): SectionMesh {
  const placements = sectionSeats(venue, sectionId);
  const baseColor = new THREE.Color(color);
  // 顏色放在 instance color，材質用白色，這樣 highlight 時換的就是實際顏色
  const geometry = new THREE.BoxGeometry(SEAT_SIZE.depth, SEAT_SIZE.height, SEAT_SIZE.width);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.name = `section:${sectionId}`;

  const indexByKey = new Map<string, number>();
  const transform = new THREE.Object3D();
  placements.forEach(({ row, seat, position, yawDeg }, i) => {
    transform.position.copy(toVector3(position));
    transform.position.y += SEAT_SIZE.height / 2; // 方塊底部貼齊座位地面
    transform.rotation.set(0, planYawToRotationY(yawDeg), 0);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    mesh.setColorAt(i, baseColor);
    indexByKey.set(`${row}:${seat}`, i);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();

  return {
    sectionId,
    mesh,
    baseColor,
    colors: { seat: baseColor, overview: baseColor },
    paint() {
      throw new Error("not implemented");
    },
    indexOf: (row, seat) => indexByKey.get(`${row}:${seat}`),
  };
}
