import { SeatViewError } from "./errors";
import { distance, elevationAngle, horizontalAngle, horizontalDistance } from "./geometry";
import type { Layout, Section, Vec3, Venue } from "./schema";
import { cameraPose, findSection, seatPosition, seatsInRow, type CameraPose } from "./seat";

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

export function findLayout(venue: Venue, layoutId: string): Layout {
  // 用 hasOwn 而不是 venue.layouts[layoutId]，否則 "toString" 之類的 key 會拿到原型上的東西
  const layout = Object.hasOwn(venue.layouts, layoutId) ? venue.layouts[layoutId] : undefined;
  if (!layout) {
    const available = Object.keys(venue.layouts).join(", ");
    throw new SeatViewError("UNKNOWN_LAYOUT", `場館 ${venue.id} 沒有 ${layoutId} layout（可用：${available}）`);
  }
  return layout;
}

/** section 沒標 layouts 代表所有 layout 都開放。 */
export function isSectionInLayout(section: Section, layoutId: string): boolean {
  return section.layouts === undefined || section.layouts.includes(layoutId);
}

/** UI 與 MCP 共用的入口：查區 → 座位 → 相機 → 指標。 */
export function getSeatView(
  venue: Venue,
  layoutId: string,
  sectionId: string,
  row: number,
  seat: number,
): SeatView {
  const layout = findLayout(venue, layoutId);
  const section = findSection(venue, sectionId);
  if (!isSectionInLayout(section, layoutId)) {
    throw new SeatViewError("SECTION_NOT_IN_LAYOUT", `${sectionId} 區在 ${layoutId} layout 沒有開放`);
  }

  const position = seatPosition(venue, sectionId, row, seat);
  const camera = cameraPose(position, layout.focus.position);
  const eye = camera.position;
  const focusPoint = layout.focus.position;

  return {
    venueId: venue.id,
    layoutId,
    sectionId,
    row,
    seat,
    seatPosition: position,
    camera,
    metrics: {
      distance: distance(eye, focusPoint),
      horizontalDistance: horizontalDistance(eye, focusPoint),
      heightAboveFocus: eye.y - focusPoint.y,
      elevationDeg: elevationAngle(eye, focusPoint),
      horizontalDeg: horizontalAngle(eye, layout.focus),
    },
  };
}

/** 某 layout 開放的區。 */
export function listSections(venue: Venue, layoutId: string): SectionSummary[] {
  findLayout(venue, layoutId);
  return venue.sections
    .filter((section) => isSectionInLayout(section, layoutId))
    .map((section) => ({
      id: section.id,
      name: section.name,
      rows: section.rows,
      seatsPerRow: Array.from({ length: section.rows }, (_, i) => seatsInRow(section, i + 1)),
    }));
}
