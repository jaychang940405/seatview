import type { CameraMode } from "../render/viewer";

export interface SeatQuery {
  layoutId: string;
  sectionId: string;
  row: number;
  seat: number;
  mode: CameraMode;
}

export const DEFAULT_QUERY: SeatQuery = { layoutId: "concert", sectionId: "A1", row: 1, seat: 16, mode: "seat" };

/**
 * 解析 ?layout=&section=&row=&seat=&mode=，沒給的用 DEFAULT_QUERY。
 * 不檢查排號／座號是否合法（例如 row=abc 會得到 NaN），交給 core 回報錯誤，避免兩邊各寫一套驗證。
 */
export function parseSeatQuery(search: string): SeatQuery {
  throw new Error("not implemented: parseSeatQuery");
}
