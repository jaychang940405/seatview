import { SeatViewError } from "../core/errors";
import type { PlanPoint, Venue } from "../core/schema";
import { seatPosition } from "../core/seat";
import { sectionOutline } from "../core/stand";
import { findLayout, listSections } from "../core/view";
import { sectionLabel } from "./selection";

/*
 * 小地圖的資料（純函式，不碰 DOM）：取代鳥瞰的選位功能。
 * 區的輪廓來自 core 的 sectionOutline，選中座位的位置來自 core 的 seatPosition；這裡不重算幾何。
 * 平面座標 x 向右、z 向下，剛好就是 SVG 的座標方向。
 */

export interface MinimapSection {
  id: string;
  label: string;
  points: PlanPoint[];
  /** SVG path："M x z L x z … Z" */
  path: string;
  /** 點這一區時跳到的座位：排取中間、號取那一排的中間 */
  target: { row: number; seat: number };
}

export interface MinimapModel {
  /** SVG viewBox："minX minZ width height"，包住所有區與線條並留邊 */
  viewBox: string;
  sections: MinimapSection[];
  /** layout 的折線 overlay（界外線、外野牆…），只當方位參考 */
  lines: { id: string; path: string }[];
  selected: { sectionId: string; point: PlanPoint } | null;
}

/** viewBox 四周留的邊（m）。 */
const MARGIN = 6;

const round = (n: number) => Math.round(n * 10) / 10;
const pathOf = (points: PlanPoint[], closed: boolean) =>
  points.map((p, i) => `${i === 0 ? "M" : "L"} ${round(p.x)} ${round(p.z)}`).join(" ") + (closed ? " Z" : "");

export function buildMinimapModel(
  venue: Venue,
  layoutId: string,
  selected: { sectionId: string; row: number; seat: number } | null,
): MinimapModel {
  const layout = findLayout(venue, layoutId);
  const sections = listSections(venue, layoutId).map((summary): MinimapSection => {
    const points = sectionOutline(venue, summary.id);
    const row = Math.ceil(summary.rows / 2);
    const seat = Math.ceil((summary.seatsPerRow[row - 1] ?? 1) / 2);
    return { id: summary.id, label: sectionLabel(summary.id, summary.name), points, path: pathOf(points, true), target: { row, seat } };
  });
  const polylines = (layout.overlays ?? []).flatMap((overlay) => (overlay.type === "polyline" ? [overlay] : []));

  const all = [...sections.flatMap((s) => s.points), ...polylines.flatMap((l) => l.points)];
  const xs = all.map((p) => p.x);
  const zs = all.map((p) => p.z);
  const minX = Math.min(...xs) - MARGIN;
  const minZ = Math.min(...zs) - MARGIN;
  const viewBox = [minX, minZ, Math.max(...xs) + MARGIN - minX, Math.max(...zs) + MARGIN - minZ].map(round).join(" ");

  return {
    viewBox,
    sections,
    lines: polylines.map((l) => ({ id: l.id, path: pathOf(l.points, l.closed ?? false) })),
    selected: selectedPoint(venue, sections, selected),
  };
}

function selectedPoint(
  venue: Venue,
  sections: MinimapSection[],
  selected: { sectionId: string; row: number; seat: number } | null,
): MinimapModel["selected"] {
  if (!selected || !sections.some((s) => s.id === selected.sectionId)) return null;
  try {
    const p = seatPosition(venue, selected.sectionId, selected.row, selected.seat);
    return { sectionId: selected.sectionId, point: { x: p.x, z: p.z } };
  } catch (error) {
    if (error instanceof SeatViewError) return null;
    throw error;
  }
}
