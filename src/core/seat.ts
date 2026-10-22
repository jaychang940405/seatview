import type { Vec3, Venue } from "./schema";

/** 坐姿眼高（m），從座位地面算起。 */
export const DEFAULT_EYE_HEIGHT = 1.2;

export interface CameraPose {
  /** 眼睛位置 = 座位 + (0, eyeHeight, 0) */
  position: Vec3;
  /** 看向的點（focus） */
  target: Vec3;
}

/**
 * 座位地面中心點的位置。row、seat 從 1 開始。
 * 只算幾何，不檢查這區在某個 layout 有沒有開放。
 */
export function seatPosition(venue: Venue, sectionId: string, row: number, seat: number): Vec3 {
  throw new Error("not implemented: seatPosition");
}

export function cameraPose(
  seatPos: Vec3,
  focusPoint: Vec3,
  opts?: { eyeHeight?: number },
): CameraPose {
  throw new Error("not implemented: cameraPose");
}
