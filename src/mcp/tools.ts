/**
 * MCP tool 的處理函式：輸入 → 結果物件。只用 core，不碰 SDK，方便單元測試。
 * server.ts 負責把它們註冊成 MCP tool。
 */
import { SeatViewError, type SeatViewErrorCode } from "../core/errors.ts";
import type { Provenance, Vec3, Venue } from "../core/schema.ts";
import { findLayout, getSeatView, listSections } from "../core/view.ts";
import { compareText, errorText, provenanceText, sectionsText, seatViewText, venuesText } from "./format.ts";
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
  const a = Math.abs(horizontalDeg);
  if (a <= 15) return "正面";
  if (a > 165) return "背面";
  const right = horizontalDeg > 0;
  if (a <= 60) return right ? "右前方" : "左前方";
  if (a <= 120) return right ? "右側" : "左側";
  return right ? "右後方" : "左後方";
}

// ── 共用：找場館、把 core 的錯誤轉成附提示的 ToolError ──

// 不用建構子參數屬性（constructor(readonly error)）：Node 的型別剝除不支援這種寫法
class ToolFailure extends Error {
  readonly error: ToolError;

  constructor(error: ToolError) {
    super(error.message);
    this.error = error;
  }
}

function venueOf(registry: VenueRegistry, id: string): Venue {
  const venue = registry.get(id);
  if (!venue) {
    throw new ToolFailure({ code: "UNKNOWN_VENUE", message: `沒有 ${id} 這個場館`, hint: `可用的場館：${registry.ids.join("、")}` });
  }
  return venue;
}

/** 依錯誤種類補上提示：可用的 layout、這個 layout 開放的區。 */
function hintFor(venue: Venue, layoutId: string, code: SeatViewErrorCode): string | undefined {
  const layouts = Object.keys(venue.layouts);
  if (code === "UNKNOWN_LAYOUT") return `可用的 layout：${layouts.join("、")}`;
  if (code === "UNKNOWN_SECTION" || code === "SECTION_NOT_IN_LAYOUT") {
    const open = Object.hasOwn(venue.layouts, layoutId) ? listSections(venue, layoutId).map((s) => s.id) : venue.sections.map((s) => s.id);
    return `${layoutId} 開放的區：${open.join("、")}`;
  }
  return "用 list_sections 查每區的排數與每排席數";
}

function run<T>(registry: VenueRegistry, venueId: string, layoutId: string | undefined, body: (venue: Venue) => T, text: (data: T) => string): ToolOutcome<T> {
  try {
    const venue = venueOf(registry, venueId);
    try {
      const data = body(venue);
      return { ok: true, data, text: text(data) };
    } catch (e) {
      if (!(e instanceof SeatViewError)) throw e;
      throw new ToolFailure({ code: e.code, message: e.message, hint: layoutId === undefined ? undefined : hintFor(venue, layoutId, e.code) });
    }
  } catch (e) {
    if (!(e instanceof ToolFailure)) throw e;
    return { ok: false, error: e.error, text: errorText(e.error) };
  }
}

const named = (id: string, name: string): Named => ({ id, name });

function layoutOf(venue: Venue, layoutId: string): Named {
  return named(layoutId, findLayout(venue, layoutId).name);
}

const disclaimerOf = (venue: Venue) => (venue.meta ? { disclaimer: venue.meta.disclaimer } : {});

// ── tools ──

export function listVenues(registry: VenueRegistry): ToolOutcome<ListVenuesOutput> {
  const venues = registry.ids.map((id) => {
    const venue = registry.get(id) as Venue;
    return {
      ...named(venue.id, venue.name),
      layouts: Object.entries(venue.layouts).map(([layoutId, layout]) => named(layoutId, layout.name)),
      sectionCount: venue.sections.length,
      ...disclaimerOf(venue),
    };
  });
  const data = { venues };
  return { ok: true, data, text: venuesText(data) };
}

export function listSectionsTool(
  registry: VenueRegistry,
  input: { venue: string; layout: string },
): ToolOutcome<ListSectionsOutput> {
  return run(
    registry,
    input.venue,
    input.layout,
    (venue) => ({
      venue: named(venue.id, venue.name),
      layout: layoutOf(venue, input.layout),
      sections: listSections(venue, input.layout).map((s) => ({
        id: s.id,
        ...(s.name !== undefined && { name: s.name }),
        rows: s.rows,
        totalSeats: s.seatsPerRow.reduce((a, b) => a + b, 0),
        seatsPerRow: s.seatsPerRow,
      })),
    }),
    sectionsText,
  );
}

function seatView(venue: Venue, layoutId: string, ref: SeatRef) {
  const view = getSeatView(venue, layoutId, ref.section, ref.row, ref.seat);
  return { view, direction: directionOf(view.metrics.horizontalDeg) };
}

export function getSeatViewTool(
  registry: VenueRegistry,
  input: { venue: string; layout: string } & SeatRef,
): ToolOutcome<SeatViewOutput> {
  return run(
    registry,
    input.venue,
    input.layout,
    (venue) => {
      const { view, direction } = seatView(venue, input.layout, input);
      const sectionName = venue.sections.find((s) => s.id === view.sectionId)?.name;
      return {
        venue: named(venue.id, venue.name),
        layout: layoutOf(venue, input.layout),
        section: { id: view.sectionId, ...(sectionName !== undefined && { name: sectionName }) },
        row: view.row,
        seat: view.seat,
        seatPosition: view.seatPosition,
        camera: view.camera,
        metrics: view.metrics,
        direction,
        ...disclaimerOf(venue),
      };
    },
    seatViewText,
  );
}

export function compareSeats(
  registry: VenueRegistry,
  input: { venue: string; layout: string; seats: SeatRef[] },
): ToolOutcome<CompareSeatsOutput> {
  return run(
    registry,
    input.venue,
    input.layout,
    (venue) => {
      const layout = layoutOf(venue, input.layout); // layout 不存在時整個比較直接失敗
      const results: CompareSeatsOutput["results"] = input.seats.map((ref) => {
        try {
          const { view, direction } = seatView(venue, input.layout, ref);
          return { ...ref, ok: true as const, metrics: view.metrics, direction };
        } catch (e) {
          if (!(e instanceof SeatViewError)) throw e;
          return { ...ref, ok: false as const, error: { code: e.code, message: e.message, hint: hintFor(venue, input.layout, e.code) } };
        }
      });
      const okIndexes = results.flatMap((r, i) => (r.ok ? [i] : []));
      const metricOf = (i: number) => {
        const r = results[i];
        return r?.ok ? r.metrics : undefined;
      };
      const sortBy = (key: (m: Metrics) => number) =>
        [...okIndexes].sort((a, b) => key(metricOf(a) as Metrics) - key(metricOf(b) as Metrics));
      return {
        venue: named(venue.id, venue.name),
        layout,
        results,
        ranking: { byDistance: sortBy((m) => m.distance), byCenter: sortBy((m) => Math.abs(m.horizontalDeg)) },
        ...disclaimerOf(venue),
      };
    },
    compareText,
  );
}

export function getVenueProvenance(registry: VenueRegistry, input: { venue: string }): ToolOutcome<ProvenanceOutput> {
  return run(
    registry,
    input.venue,
    undefined,
    (venue) => ({ venue: named(venue.id, venue.name), ...disclaimerOf(venue), provenance: venue.meta?.provenance ?? [] }),
    provenanceText,
  );
}
