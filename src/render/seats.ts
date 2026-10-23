import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Venue } from "../core/schema";
import { sectionSeats } from "../core/seat";
import { planYawToRotationY, toVector3 } from "./convert";

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

/** 椅面前緣在座位中心前方多少（m）；椅面往後延伸 seatDepth，椅背接在椅面後緣。 */
const SEAT_FRONT_X = 0.22;
/** 椅面下方的支柱（m）：只是讓椅面不要看起來浮在空中。 */
const PEDESTAL = { depth: 0.08, width: 0.1 } as const;

/** 一張椅子：椅面、往後傾的椅背、椅面下的支柱，合成一個 geometry。 */
export function chairGeometry(): THREE.BufferGeometry {
  const seatRearX = SEAT_FRONT_X - CHAIR.seatDepth;

  const seat = new THREE.BoxGeometry(CHAIR.seatDepth, CHAIR.seatThickness, CHAIR.width);
  seat.translate(SEAT_FRONT_X - CHAIR.seatDepth / 2, CHAIR.seatHeight - CHAIR.seatThickness / 2, 0);

  // 椅背先立在原點上方，以後下緣為軸往後（−x）傾，再移到椅面後緣。
  // 傾斜後最高的是「前上角」：高度 = 長度·cos + 厚度·sin，長度要算到這個角剛好到 backTop
  const tilt = THREE.MathUtils.degToRad(CHAIR.backTiltDeg);
  const backLength = (CHAIR.backTop - CHAIR.seatHeight - CHAIR.backThickness * Math.sin(tilt)) / Math.cos(tilt);
  const back = new THREE.BoxGeometry(CHAIR.backThickness, backLength, CHAIR.width);
  back.translate(CHAIR.backThickness / 2, backLength / 2, 0);
  back.rotateZ(tilt);
  back.translate(seatRearX, CHAIR.seatHeight, 0);

  const pedestalHeight = CHAIR.seatHeight - CHAIR.seatThickness;
  const pedestal = new THREE.BoxGeometry(PEDESTAL.depth, pedestalHeight, PEDESTAL.width);
  pedestal.translate(seatRearX + CHAIR.seatDepth / 2, pedestalHeight / 2, 0);

  const chair = mergeGeometries([seat, back, pedestal]);
  for (const part of [seat, back, pedestal]) part.dispose();
  if (!chair) throw new Error("座椅 geometry 合併失敗");
  return chair;
}

export interface SectionMesh {
  sectionId: string;
  /** name = "section:<sectionId>"，一個 instance 一個座位，順序同 sectionSeats */
  mesh: THREE.InstancedMesh;
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
  const colors: Record<ColorMode, THREE.Color> = {
    seat: SEAT_NEUTRAL.clone(),
    overview: SEAT_NEUTRAL.clone().lerp(new THREE.Color(color), OVERVIEW_TINT),
  };
  // 顏色放在 instance color，材質用白色，這樣 highlight 時換的就是實際顏色
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const mesh = new THREE.InstancedMesh(chairGeometry(), material, placements.length);
  mesh.name = `section:${sectionId}`;

  const indexByKey = new Map<string, number>();
  const transform = new THREE.Object3D();
  placements.forEach(({ row, seat, position, yawDeg }, i) => {
    transform.position.copy(toVector3(position));
    transform.rotation.set(0, planYawToRotationY(yawDeg), 0);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    indexByKey.set(`${row}:${seat}`, i);
  });
  mesh.instanceMatrix.needsUpdate = true;

  const paint = (mode: ColorMode) => {
    for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, colors[mode]);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  paint("seat");
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();

  return {
    sectionId,
    mesh,
    colors,
    paint,
    indexOf: (row, seat) => indexByKey.get(`${row}:${seat}`),
  };
}
