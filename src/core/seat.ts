import { SeatViewError } from "./errors.ts";
import { DEG, normalAwayFrom, normalizeDeg } from "./geometry.ts";
import type { Section, Vec3, Venue } from "./schema.ts";

/** 坐姿眼高（m），從座位地面算起。 */
export const DEFAULT_EYE_HEIGHT = 1.2;

export interface CameraPose {
  /** 眼睛位置 = 座位 + (0, eyeHeight, 0) */
  position: Vec3;
  /** 看向的點（focus） */
  target: Vec3;
}

export function findSection(venue: Venue, sectionId: string): Section {
  const section = venue.sections.find((s) => s.id === sectionId);
  if (!section) {
    throw new SeatViewError("UNKNOWN_SECTION", `場館 ${venue.id} 沒有 ${sectionId} 區`);
  }
  return section;
}

/** 第 row 排（從 1 開始）的座位數。 */
export function seatsInRow(section: Section, row: number): number {
  if (typeof section.seatsPerRow === "number") return section.seatsPerRow;
  const count = section.seatsPerRow[row - 1];
  if (count === undefined) {
    throw new SeatViewError("ROW_OUT_OF_RANGE", `${section.id} 區沒有第 ${row} 排`);
  }
  return count;
}

/**
 * 座位地面中心點的位置。row、seat 從 1 開始。
 * 只算幾何，不檢查這區在某個 layout 有沒有開放。
 */
export function seatPosition(venue: Venue, sectionId: string, row: number, seat: number): Vec3 {
  const section = findSection(venue, sectionId);
  if (!Number.isInteger(row) || row < 1 || row > section.rows) {
    throw new SeatViewError("ROW_OUT_OF_RANGE", `${section.id} 區只有第 1–${section.rows} 排，收到 ${row}`);
  }
  const count = seatsInRow(section, row);
  if (!Number.isInteger(seat) || seat < 1 || seat > count) {
    throw new SeatViewError("SEAT_OUT_OF_RANGE", `${section.id} 區第 ${row} 排只有 1–${count} 號，收到 ${seat}`);
  }
  return placeSeat(section, row, seat, count).position;
}

export interface SeatPlacement {
  row: number;
  seat: number;
  /** 等於 seatPosition(...) */
  position: Vec3;
  /** 座位面向的方向（平面角度，範圍 (-180, 180]）：arc 面向圓心，linear 面向 facing 那側 */
  yawDeg: number;
}

/** 整區所有座位，依排、號排序。 */
export function sectionSeats(venue: Venue, sectionId: string): SeatPlacement[] {
  const section = findSection(venue, sectionId);
  const seats: SeatPlacement[] = [];
  for (let row = 1; row <= section.rows; row++) {
    const count = seatsInRow(section, row);
    for (let seat = 1; seat <= count; seat++) seats.push(placeSeat(section, row, seat, count));
  }
  return seats;
}

/** 位置與朝向的實際算式；呼叫前 row、seat 必須已檢查過範圍。 */
function placeSeat(section: Section, row: number, seat: number, count: number): SeatPlacement {
  // from/to 是區塊邊緣（有 rowSpans 時是這一排用的那一段），座位中心落在每格中間
  const [spanStart, spanEnd] = section.rowSpans?.[row - 1] ?? [0, 1];
  const t = spanStart + ((seat - 0.5) / count) * (spanEnd - spanStart);
  const back = (row - 1) * section.rowDepth;
  const y = section.baseHeight + (row - 1) * section.rowRise;

  switch (section.type) {
    case "arc": {
      const radius = section.innerRadius + back;
      const angleDeg = section.fromDeg + t * (section.toDeg - section.fromDeg);
      const angle = angleDeg / DEG;
      return {
        row,
        seat,
        position: {
          x: section.center.x + radius * Math.cos(angle),
          y,
          z: section.center.z + radius * Math.sin(angle),
        },
        // 面向圓心 = 座位所在角度轉半圈
        yawDeg: normalizeDeg(angleDeg + 180),
      };
    }
    case "linear": {
      const normal = normalAwayFrom(section.from, section.to, section.facing);
      if (!normal) {
        throw new Error(`${section.id} 區的 from/to/facing 無法決定後方，請先用 parseVenue 驗證`);
      }
      return {
        row,
        seat,
        position: {
          x: section.from.x + t * (section.to.x - section.from.x) + back * normal.x,
          y,
          z: section.from.z + t * (section.to.z - section.from.z) + back * normal.z,
        },
        // normal 指向後方，座位面向它的反方向
        yawDeg: normalizeDeg(Math.atan2(-normal.z, -normal.x) * DEG),
      };
    }
  }
}

export function cameraPose(
  seatPos: Vec3,
  focusPoint: Vec3,
  opts?: { eyeHeight?: number },
): CameraPose {
  const eyeHeight = opts?.eyeHeight ?? DEFAULT_EYE_HEIGHT;
  return {
    position: { x: seatPos.x, y: seatPos.y + eyeHeight, z: seatPos.z },
    target: { ...focusPoint },
  };
}
