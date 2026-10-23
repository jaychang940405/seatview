/**
 * MCP tool 的處理函式：輸入 → 結果物件。只用 core，不碰 SDK，方便單元測試。
 * server.ts 負責把它們註冊成 MCP tool。
 */
import type { SeatViewErrorCode } from "../core/errors.ts";
import type { Provenance, Vec3 } from "../core/schema.ts";
import type { VenueRegistry } from "./venues.ts";

/** 相對 focus 朝向的方位：演唱會的「正面」是舞台正前方；棒球的「正面」是本壘後方。 */
export type Direction = "正面" | "右前方" | "右側" | "右後方" | "背面" | "左後方" | "左側" | "左前方";

export interface ToolError {
  code: SeatViewErrorCode | "UNKNOWN_VENUE";
  message: string;
  /** 給呼叫端的改正提示，例如可用的區 id */
  hint?: string;
}

export type ToolOutcome<T> = { ok: true; data: T; text: string } | { ok: false; error: ToolError; text: string };

type Named = { id: string; name: string };

export interface Metrics {
  distance: number;
  horizontalDistance: number;
  heightAboveFocus: number;
  elevationDeg: number;
  horizontalDeg: number;
}

export interface ListVenuesOutput {
  venues: (Named & { layouts: Named[]; sectionCount: number; disclaimer?: string })[];
}

export interface ListSectionsOutput {
  venue: Named;
  layout: Named;
  sections: { id: string; name?: string; rows: number; totalSeats: number; seatsPerRow: number[] }[];
}

export interface SeatViewOutput {
  venue: Named;
  layout: Named;
  section: { id: string; name?: string };
  row: number;
  seat: number;
  seatPosition: Vec3;
  camera: { position: Vec3; target: Vec3 };
  metrics: Metrics;
  direction: Direction;
  disclaimer?: string;
}

export type SeatRef = { section: string; row: number; seat: number };

export interface CompareSeatsOutput {
  venue: Named;
  layout: Named;
  results: ((SeatRef & { ok: true; metrics: Metrics; direction: Direction }) | (SeatRef & { ok: false; error: ToolError }))[];
  /** results 的 index：只含成功的座位 */
  ranking: { byDistance: number[]; byCenter: number[] };
  disclaimer?: string;
}

export interface ProvenanceOutput {
  venue: Named;
  disclaimer?: string;
  provenance: Provenance[];
}

/** 水平偏角 → 方位標籤：±15° 內為正面，60°、120°、165° 分界（C 級設計選擇）。 */
export function directionOf(horizontalDeg: number): Direction {
  throw new Error("not implemented: directionOf");
}

export function listVenues(registry: VenueRegistry): ToolOutcome<ListVenuesOutput> {
  throw new Error("not implemented: listVenues");
}

export function listSectionsTool(
  registry: VenueRegistry,
  input: { venue: string; layout: string },
): ToolOutcome<ListSectionsOutput> {
  throw new Error("not implemented: listSectionsTool");
}

export function getSeatViewTool(
  registry: VenueRegistry,
  input: { venue: string; layout: string } & SeatRef,
): ToolOutcome<SeatViewOutput> {
  throw new Error("not implemented: getSeatViewTool");
}

export function compareSeats(
  registry: VenueRegistry,
  input: { venue: string; layout: string; seats: SeatRef[] },
): ToolOutcome<CompareSeatsOutput> {
  throw new Error("not implemented: compareSeats");
}

export function getVenueProvenance(registry: VenueRegistry, input: { venue: string }): ToolOutcome<ProvenanceOutput> {
  throw new Error("not implemented: getVenueProvenance");
}
