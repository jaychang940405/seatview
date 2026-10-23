import type { Section, Venue } from "../core/schema";
import { findSection, seatsInRow } from "../core/seat";
import { findLayout, isSectionInLayout, listSections } from "../core/view";
import type { CameraMode } from "../render/viewer";
import type { SeatQuery } from "./query";

/*
 * 選位面板的狀態規則（純函式，不碰 DOM，可直接測試）。
 * 原則：畫面上的座位一定是使用者指定的那一席；不是的話一定明說改成了哪一席。
 * - 使用者直接輸入的排、號不修正，超出範圍交給 core 回報錯誤
 * - 原本合法、因為換區／換排而變得不合法的值，改成最接近的合法值並提示
 */

export type Selection = SeatQuery;

export type Change =
  | { kind: "venue"; venueId: string }
  | { kind: "layout"; layoutId: string }
  | { kind: "section"; sectionId: string }
  | { kind: "row"; row: number }
  | { kind: "seat"; seat: number }
  /** 小地圖點選：一次設定區、排、號 */
  | { kind: "pick"; sectionId: string; row: number; seat: number }
  | { kind: "mode"; mode: CameraMode };

export interface Option {
  id: string;
  label: string;
  /** 短名稱（layout 才有，給右上角的場地切換鈕用） */
  short?: string;
  /** 分組（區的樓層，例如 B1、L2）：面板用 optgroup 分開 */
  group?: string;
}

export interface PanelOptions {
  venues: Option[];
  layouts: Option[];
  sections: Option[];
  /** 這一區有幾排（排號 1..rows） */
  rows: number;
  /** 這一排有幾席；排號不合法時為 null */
  seats: number | null;
}

export interface ChangeResult {
  selection: Selection;
  /** 自動修正時給使用者看的說明；沒有修正就是空陣列 */
  notices: string[];
}

/** 面板要顯示的選項；selection 必須已經過 normalize（場館、layout、區都存在）。 */
export function panelOptions(venues: readonly Venue[], selection: Selection): PanelOptions {
  const venue = venueOf(venues, selection.venueId);
  const section = findSection(venue, selection.sectionId);
  return {
    venues: venues.map((v) => ({ id: v.id, label: v.name })),
    layouts: Object.entries(venue.layouts).map(([id, layout]) => ({ id, label: layout.name, short: layout.name.split("（")[0] })),
    sections: listSections(venue, selection.layoutId).map((s) => ({
      id: s.id,
      label: sectionLabel(s.id, s.name),
      ...(s.level !== undefined && { group: s.level }),
    })),
    rows: section.rows,
    seats: rowFits(section, selection.row) ? seatsInRow(section, selection.row) : null,
  };
}

/** 啟動時處理網址參數：場館、layout、區不存在就換成可用的並提示；排、號照網址保留。 */
export function normalize(venues: readonly Venue[], query: SeatQuery): ChangeResult {
  const venue = venues.find((v) => v.id === query.venueId);
  if (!venue) {
    const fallback = venues[0];
    if (!fallback) throw new Error("沒有任何場館");
    return { selection: venueDefaults(fallback, query.mode), notices: [`沒有 ${query.venueId} 這個場館，已改為${fallback.name}`] };
  }

  const notices: string[] = [];
  let layoutId = query.layoutId;
  if (!Object.hasOwn(venue.layouts, layoutId)) {
    layoutId = firstLayoutId(venue);
    notices.push(`沒有 ${query.layoutId} 這個 layout（UNKNOWN_LAYOUT），已改為「${findLayout(venue, layoutId).name}」`);
  }
  const section = resolveSection(venue, layoutId, query.sectionId, notices);
  return { selection: { ...query, layoutId, sectionId: section.id }, notices };
}

export function applyChange(venues: readonly Venue[], selection: Selection, change: Change): ChangeResult {
  switch (change.kind) {
    case "venue": {
      if (change.venueId === selection.venueId) return { selection, notices: [] };
      const venue = venues.find((v) => v.id === change.venueId);
      if (!venue) return normalize(venues, { ...selection, venueId: change.venueId });
      return { selection: venueDefaults(venue, selection.mode), notices: [] };
    }
    case "layout": {
      const venue = venueOf(venues, selection.venueId);
      findLayout(venue, change.layoutId);
      return moveSection(venue, selection, change.layoutId, selection.sectionId);
    }
    case "section":
      return moveSection(venueOf(venues, selection.venueId), selection, selection.layoutId, change.sectionId);
    case "row": {
      const section = findSection(venueOf(venues, selection.venueId), selection.sectionId);
      const notices: string[] = [];
      const seat = carrySeat(section, selection.row, section, change.row, selection.seat, notices);
      return { selection: { ...selection, row: change.row, seat }, notices };
    }
    case "seat":
      return { selection: { ...selection, seat: change.seat }, notices: [] };
    case "pick": {
      // 小地圖給的排號是那一區的中央座位，本來就合法；區若不開放照 resolveSection 的規則改並提示
      const notices: string[] = [];
      const section = resolveSection(venueOf(venues, selection.venueId), selection.layoutId, change.sectionId, notices);
      return { selection: { ...selection, sectionId: section.id, row: change.row, seat: change.seat }, notices };
    }
    case "mode":
      return { selection: { ...selection, mode: change.mode }, notices: [] };
  }
}

/** 排、號的 − / + 按鈕：加減 1，限制在 1 到上限之間（上限未知時只限制下限）。 */
export function stepValue(current: number, delta: 1 | -1, max: number | null): number {
  if (!Number.isFinite(current)) return 1;
  const next = Math.max(1, Math.round(current) + delta);
  return max === null ? next : Math.min(next, max);
}

/** 寫回網址用；與 parseSeatQuery 互逆。不寫 mode=：鳥瞰只在除錯時以 debug=overview 出現。 */
export function toSearch(selection: Selection): string {
  const params = new URLSearchParams({
    venue: selection.venueId,
    layout: selection.layoutId,
    section: selection.sectionId,
    row: String(selection.row),
    seat: String(selection.seat),
  });
  if (selection.mode === "overview") params.set("debug", "overview");
  return `?${params}`;
}

function venueOf(venues: readonly Venue[], venueId: string): Venue {
  const venue = venues.find((v) => v.id === venueId);
  if (!venue) throw new Error(`沒有 ${venueId} 這個場館；selection 應先經過 normalize`);
  return venue;
}

/** 名稱已經以代號開頭（例如「A1 區」）就不再重複代號。 */
export function sectionLabel(id: string, name?: string): string {
  if (!name) return id;
  return name.startsWith(id) ? name : `${id} ${name}`;
}

function firstLayoutId(venue: Venue): string {
  const layoutId = Object.keys(venue.layouts)[0];
  if (layoutId === undefined) throw new Error(`${venue.id} 沒有任何 layout`);
  return layoutId;
}

function firstSection(venue: Venue, layoutId: string): Section {
  const section = venue.sections.find((s) => isSectionInLayout(s, layoutId));
  if (!section) throw new Error(`${venue.id} 的 ${layoutId} layout 沒有開放任何區`);
  return section;
}

/** 場館的預設座位：第一個 layout、第一區、第 1 排中間那一席。 */
function venueDefaults(venue: Venue, mode: CameraMode): Selection {
  const layoutId = firstLayoutId(venue);
  const section = firstSection(venue, layoutId);
  return { venueId: venue.id, layoutId, sectionId: section.id, row: 1, seat: Math.ceil(seatsInRow(section, 1) / 2), mode };
}

/** 區不存在或在這個 layout 沒開放 → 改成第一區並提示。 */
function resolveSection(venue: Venue, layoutId: string, sectionId: string, notices: string[]): Section {
  const section = venue.sections.find((s) => s.id === sectionId);
  if (section && isSectionInLayout(section, layoutId)) return section;
  const fallback = firstSection(venue, layoutId);
  notices.push(
    section
      ? `${sectionId} 在「${findLayout(venue, layoutId).name}」沒有開放，已改為 ${fallback.id}`
      : `沒有 ${sectionId} 這一區（UNKNOWN_SECTION），已改為 ${fallback.id}`,
  );
  return fallback;
}

/** 換到另一區（或另一個 layout）：排、號原本合法、在新區變得不合法時才修正。 */
function moveSection(venue: Venue, selection: Selection, layoutId: string, sectionId: string): ChangeResult {
  const notices: string[] = [];
  const from = findSection(venue, selection.sectionId);
  const to = resolveSection(venue, layoutId, sectionId, notices);
  const row = carryRow(from, to, selection.row, notices);
  const seat = carrySeat(from, selection.row, to, row, selection.seat, notices);
  return { selection: { ...selection, layoutId, sectionId: to.id, row, seat }, notices };
}

function rowFits(section: Section, row: number): boolean {
  return Number.isInteger(row) && row >= 1 && row <= section.rows;
}

function seatFits(section: Section, row: number, seat: number): boolean {
  return rowFits(section, row) && Number.isInteger(seat) && seat >= 1 && seat <= seatsInRow(section, row);
}

function carryRow(from: Section, to: Section, row: number, notices: string[]): number {
  if (!rowFits(from, row) || rowFits(to, row)) return row;
  notices.push(`${to.id} 只有 1–${to.rows} 排，已改為第 ${to.rows} 排`);
  return to.rows;
}

function carrySeat(from: Section, fromRow: number, to: Section, toRow: number, seat: number, notices: string[]): number {
  if (!seatFits(from, fromRow, seat) || !rowFits(to, toRow) || seatFits(to, toRow, seat)) return seat;
  const count = seatsInRow(to, toRow);
  notices.push(`${to.id} 第 ${toRow} 排只有 1–${count} 號，已改為 ${count} 號`);
  return count;
}
