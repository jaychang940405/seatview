import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Venue } from "../core/schema";
import { findDrawableSection, sectionSeats } from "../core/seat";
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

/** 鳥瞰（除錯）配色的底色：中性的深藍灰，再混入分區色。 */
export const SEAT_NEUTRAL = new THREE.Color("#3b4d61");

/**
 * 座位視角的椅子顏色：中灰、淺灰、深灰各約 1/3，不規則配置。
 * 顏色以參考照片取樣的三群為目標校色（見 docs/look-targets.md），不是官方配色或量測值。
 */
export const SEAT_PALETTE = [new THREE.Color("#4a4d47"), new THREE.Color("#c6c9bf"), new THREE.Color("#171a14")] as const;
export const SEAT_PALETTE_WEIGHTS = [0.34, 0.33, 0.33] as const;

/** 這一席在 SEAT_PALETTE 裡的顏色：由 (區、排、號) 雜湊決定，每次都一樣。 */
export function seatPaletteIndex(sectionId: string, row: number, seat: number): number {
  // FNV-1a（32 位元），再用 MurmurHash3 的 fmix32 打散：相鄰座位的字串只差一兩個字元，不打散會有規律
  let hash = 0x811c9dc5;
  for (const char of `${sectionId}:${row}:${seat}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  // 雜湊換成 [0, 1) 再依比例切段
  const u = (hash >>> 0) / 4294967296;
  let cumulative = 0;
  for (let i = 0; i < SEAT_PALETTE_WEIGHTS.length; i++) {
    cumulative += SEAT_PALETTE_WEIGHTS[i] ?? 0;
    if (u < cumulative) return i;
  }
  return SEAT_PALETTE.length - 1;
}
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
  /** 第 index 席在該模式下的顏色 */
  colorAt(mode: ColorMode, index: number): THREE.Color;
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
  // 有 seatColor 的區（例如打者之眼）座位視角一律用那個顏色，不混色
  const { seatColor } = findDrawableSection(venue, sectionId);
  const fixed = seatColor === undefined ? null : new THREE.Color(seatColor);
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

  const palette = Uint8Array.from(placements, ({ row, seat }) => seatPaletteIndex(sectionId, row, seat));
  const colorAt = (mode: ColorMode, index: number) =>
    mode === "overview" ? colors.overview : (fixed ?? SEAT_PALETTE[palette[index] ?? 0] ?? colors.seat);
  const paint = (mode: ColorMode) => {
    for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, colorAt(mode, i));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  paint("seat");
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();

  return {
    sectionId,
    mesh,
    colorAt,
    paint,
    indexOf: (row, seat) => indexByKey.get(`${row}:${seat}`),
  };
}
