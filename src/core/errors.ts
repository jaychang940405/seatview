export type SeatViewErrorCode =
  | "UNKNOWN_LAYOUT"
  | "UNKNOWN_SECTION"
  | "SECTION_NOT_IN_LAYOUT"
  | "ROW_OUT_OF_RANGE"
  | "SEAT_OUT_OF_RANGE";

/** 查詢座位時的使用者輸入錯誤；MCP 依 code 回傳錯誤訊息。 */
export class SeatViewError extends Error {
  readonly code: SeatViewErrorCode;

  constructor(code: SeatViewErrorCode, message: string) {
    super(message);
    this.name = "SeatViewError";
    this.code = code;
  }
}
