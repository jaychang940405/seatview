import type { CameraMode } from "../render/viewer";

export interface SeatQuery {
  venueId: string;
  layoutId: string;
  sectionId: string;
  row: number;
  seat: number;
  mode: CameraMode;
}

export const DEFAULT_QUERY: SeatQuery = {
  venueId: "demo-arena",
  layoutId: "concert",
  sectionId: "A1",
  row: 1,
  seat: 16,
  mode: "seat",
};

/**
 * 解析 ?venue=&layout=&section=&row=&seat=，沒給的用 DEFAULT_QUERY。
 * 鳥瞰是隱藏的除錯模式：?debug=overview（舊連結的 mode=overview 是別名）；UI 沒有入口。
 * 不檢查排號／座號是否合法（例如 row=abc 會得到 NaN），交給 core 回報錯誤，避免兩邊各寫一套驗證。
 */
export function parseSeatQuery(search: string): SeatQuery {
  const params = new URLSearchParams(search);
  const number = (key: string, fallback: number) => {
    const value = params.get(key);
    return value === null ? fallback : Number(value);
  };
  return {
    venueId: params.get("venue") ?? DEFAULT_QUERY.venueId,
    layoutId: params.get("layout") ?? DEFAULT_QUERY.layoutId,
    sectionId: params.get("section") ?? DEFAULT_QUERY.sectionId,
    row: number("row", DEFAULT_QUERY.row),
    seat: number("seat", DEFAULT_QUERY.seat),
    mode: params.get("debug") === "overview" || params.get("mode") === "overview" ? "overview" : "seat",
  };
}
