import * as THREE from "three";
import type { Venue } from "../core/schema";
import { sectionSeats } from "../core/seat";
import { planYawToRotationY, toVector3 } from "./convert";

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
    indexOf: (row, seat) => indexByKey.get(`${row}:${seat}`),
  };
}
