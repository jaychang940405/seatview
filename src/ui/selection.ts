import type { Venue } from "../core/schema";
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
  | { kind: "mode"; mode: CameraMode };

export interface Option {
  id: string;
  label: string;
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
export function panelOptions(_venues: readonly Venue[], _selection: Selection): PanelOptions {
  throw new Error("not implemented");
}

/** 啟動時處理網址參數：場館、layout、區不存在就換成可用的並提示；排、號照網址保留。 */
export function normalize(_venues: readonly Venue[], _query: SeatQuery): ChangeResult {
  throw new Error("not implemented");
}

export function applyChange(_venues: readonly Venue[], _selection: Selection, _change: Change): ChangeResult {
  throw new Error("not implemented");
}

/** 寫回網址用；與 parseSeatQuery 互逆。 */
export function toSearch(_selection: Selection): string {
  throw new Error("not implemented");
}
