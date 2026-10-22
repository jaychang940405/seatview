import type { CameraPose } from "./seat";
import type { Vec3, Venue } from "./schema";

export interface SeatView {
  venueId: string;
  layoutId: string;
  sectionId: string;
  row: number;
  seat: number;
  seatPosition: Vec3;
  camera: CameraPose;
  metrics: {
    /** 眼睛到 focus 的直線距離（m） */
    distance: number;
    /** 平面距離（m） */
    horizontalDistance: number;
    /** 眼睛比 focus 高幾 m（負值 = 比較低） */
    heightAboveFocus: number;
    elevationDeg: number;
    horizontalDeg: number;
  };
}

export interface SectionSummary {
  id: string;
  name?: string;
  rows: number;
  /** 每排座位數，長度 = rows */
  seatsPerRow: number[];
}

/** UI 與 MCP 共用的入口：查區 → 座位 → 相機 → 指標。 */
export function getSeatView(
  venue: Venue,
  layoutId: string,
  sectionId: string,
  row: number,
  seat: number,
): SeatView {
  throw new Error("not implemented: getSeatView");
}

/** 某 layout 開放的區。 */
export function listSections(venue: Venue, layoutId: string): SectionSummary[] {
  throw new Error("not implemented: listSections");
}
